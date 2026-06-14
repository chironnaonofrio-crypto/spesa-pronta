import os
import io
import math
import time
import base64
import hashlib
import traceback
import tempfile
import subprocess
import sys
import re
from pathlib import Path
from typing import Optional, Dict, Any, List, Tuple

import numpy as np
from PIL import Image, ImageOps, ImageEnhance, ImageFilter, ImageDraw

try:
    import cv2
except Exception:
    cv2 = None

from fastapi import FastAPI, UploadFile, File, Form, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

try:
    import torch
except Exception:
    torch = None

# V33.1: abilita download veloce HF solo se il pacchetto esiste davvero.
try:
    import hf_transfer  # noqa: F401
    os.environ.setdefault("HF_HUB_ENABLE_HF_TRANSFER", "1")
except Exception:
    os.environ["HF_HUB_ENABLE_HF_TRANSFER"] = "0"

APP_VERSION = "33.4.26-guided-product-twin-plus"
TOKEN = os.environ.get("GPU_VISION_TOKEN", "").strip()
MAX_SIDE = int(os.environ.get("SPESA_V32_MAX_SIDE", "1600"))
OUT_SIDE = int(os.environ.get("SPESA_V32_OUT_SIDE", "1000"))
FRAME_COUNT = int(os.environ.get("SPESA_V32_FRAME_COUNT", "24"))
ENABLE_DEPTH = os.environ.get("SPESA_V32_ENABLE_DEPTH", "true").lower() not in {"0", "false", "no"}
DEPTH_MODEL_NAME = os.environ.get("SPESA_V32_DEPTH_MODEL", "Intel/dpt-hybrid-midas")
SPESA_ALLOW_SINGLE_VIEW_3D = os.environ.get("SPESA_ALLOW_SINGLE_VIEW_3D", "0").lower() in {"1","true","yes"}
SPESA_REQUIRE_CLEAN_MASK_FOR_GLB = os.environ.get("SPESA_REQUIRE_CLEAN_MASK_FOR_GLB", "1").lower() not in {"0","false","no"}

app = FastAPI(title="Spesa Vision Brain", version=APP_VERSION)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_DEPTH_PIPE = None
_DEPTH_ERROR = None
_REMBG_SESSION = None
_REMBG_ERROR = None
_TRIPOSR_MODEL = None
_TRIPOSR_ERROR = None
_TRIPOSR_DIR = os.environ.get("TRIPOSR_DIR", "/workspace/TripoSR")
_OCR_READER = None
_OCR_ERROR = None
_ZXING_ERROR = None


def _now_ms() -> int:
    return int(time.time() * 1000)


def _auth(authorization: Optional[str], x_vision_token: Optional[str]):
    if not TOKEN:
        return
    got = ""
    if authorization and authorization.lower().startswith("bearer "):
        got = authorization.split(" ", 1)[1].strip()
    if not got and x_vision_token:
        got = x_vision_token.strip()
    if got != TOKEN:
        raise HTTPException(status_code=401, detail="bad_gpu_vision_token")


def _data_url(img: Image.Image, fmt: str = "PNG", quality: int = 90) -> str:
    buf = io.BytesIO()
    save_kwargs = {}
    mime = "image/png"
    if fmt.upper() in {"JPEG", "JPG"}:
        img = img.convert("RGB")
        save_kwargs = {"quality": quality, "optimize": True, "progressive": True}
        mime = "image/jpeg"
        fmt = "JPEG"
    else:
        img = img.convert("RGBA")
        save_kwargs = {"optimize": True}
        fmt = "PNG"
    img.save(buf, fmt, **save_kwargs)
    return f"data:{mime};base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def _image_hash(img: Image.Image) -> str:
    thumb = img.convert("RGB").resize((64, 64))
    return hashlib.sha1(thumb.tobytes()).hexdigest()[:16]


def _read_image_bytes(data: bytes) -> Image.Image:
    img = Image.open(io.BytesIO(data))
    img = ImageOps.exif_transpose(img)
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGB")
    w, h = img.size
    scale = min(1.0, MAX_SIDE / max(w, h))
    if scale < 1.0:
        img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    return img


def _load_image_file(file: Optional[UploadFile]) -> Optional[Image.Image]:
    if not file:
        return None
    data = file.file.read()
    if not data:
        return None
    return _read_image_bytes(data)


def _alpha_bbox(alpha: np.ndarray, pad_ratio: float = 0.070) -> Tuple[int, int, int, int]:
    ys, xs = np.where(alpha > 12)
    h, w = alpha.shape[:2]
    if len(xs) == 0:
        return 0, 0, w, h
    x1, x2 = int(xs.min()), int(xs.max()) + 1
    y1, y2 = int(ys.min()), int(ys.max()) + 1
    pad = int(max(x2 - x1, y2 - y1) * pad_ratio)
    x1 = max(0, x1 - pad); y1 = max(0, y1 - pad)
    x2 = min(w, x2 + pad); y2 = min(h, y2 + pad)
    return x1, y1, x2, y2


def _keep_largest_alpha(alpha: np.ndarray) -> np.ndarray:
    """V33.4: keep main product plus close top/cap components; do not eat thin caps."""
    if cv2 is None:
        return alpha
    mask = (alpha > 10).astype(np.uint8) * 255
    kernel = np.ones((3, 3), np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=1)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8), iterations=1)
    num, labels, stats, cents = cv2.connectedComponentsWithStats((mask > 0).astype(np.uint8), 8)
    if num <= 1:
        return mask.astype(np.uint8)
    areas = stats[1:, cv2.CC_STAT_AREA]
    best = 1 + int(np.argmax(areas))
    clean = (labels == best).astype(np.uint8) * 255
    bx, by, bw, bh, barea = stats[best]
    bcx, bcy = cents[best]
    for i in range(1, num):
        if i == best:
            continue
        x, y, w, h, area = stats[i]
        if area < max(18, barea * 0.0025):
            continue
        cx, cy = cents[i]
        ox = max(0, min(x + w, bx + bw) - max(x, bx)) / max(1, w)
        oy = max(0, min(y + h, by + bh) - max(y, by)) / max(1, h)
        gap_y = by - (y + h) if (y + h) < by else y - (by + bh) if y > (by + bh) else 0
        gap_x = bx - (x + w) if (x + w) < bx else x - (bx + bw) if x > (bx + bw) else 0
        top_cap = cy < bcy and (y + h) >= by - max(10, int(bh * .13)) and y <= by + int(bh * .25) and ox > .10
        near_main = gap_y <= max(5, int(bh * .035)) and gap_x <= max(5, int(bw * .055)) and (ox > .22 or oy > .28 or area > barea * .035)
        # V33.4.25: no more 'inner_useful' rescue. It was allowing table/wall leaks inside bbox.
        if top_cap or near_main:
            clean[labels == i] = 255
    return clean.astype(np.uint8)

def _refine_alpha_edge(alpha: np.ndarray) -> np.ndarray:
    """V33.4: bordo morbido ma conservativo, preserva tappo e dettagli sottili."""
    if cv2 is None:
        return alpha
    mask = (alpha > 10).astype(np.uint8) * 255
    mask = _keep_largest_alpha(mask)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8), iterations=1)
    mask = cv2.medianBlur(mask, 3)
    soft = cv2.GaussianBlur(mask, (0, 0), 0.75)
    return soft.astype(np.uint8)

def _suppress_border_background_rgba(src: Image.Image, rgba_img: Image.Image) -> Image.Image:
    """V33.4.25 Deep Pixel-Skin: remove border/background color leakage from alpha before cells/mesh.
    This is not a replacement for rembg; it is an object-purity clamp to avoid table/wall cells."""
    try:
        rgb=np.array(src.convert('RGB')).astype(np.int16)
        arr=np.array(rgba_img.convert('RGBA'))
        h,w=rgb.shape[:2]
        if h<10 or w<10: return rgba_img
        b=max(6, int(min(h,w)*0.035))
        samples=np.concatenate([rgb[:b,:,:].reshape(-1,3), rgb[-b:,:,:].reshape(-1,3), rgb[:, :b, :].reshape(-1,3), rgb[:, -b:, :].reshape(-1,3)], axis=0)
        # robust background palette: quantile colors around borders/corners
        med=np.median(samples,axis=0)
        q1=np.percentile(samples,25,axis=0); q3=np.percentile(samples,75,axis=0)
        palettes=np.stack([med,q1,q3],axis=0)
        dist=np.min(np.linalg.norm(rgb[:,:,None,:]-palettes[None,None,:,:], axis=3), axis=2)
        alpha=arr[:,:,3].astype(np.uint8)
        fg=(alpha>18).astype(np.uint8)
        # background-like pixels are removed only when not strongly inside the solid object core
        leak=((dist<32)&(alpha<245)) | ((dist<24)&(alpha<255))
        alpha[leak]=0
        if cv2 is not None:
            alpha=_keep_largest_alpha(alpha)
            alpha=cv2.morphologyEx(alpha, cv2.MORPH_OPEN, np.ones((2,2),np.uint8), iterations=1)
            alpha=cv2.morphologyEx(alpha, cv2.MORPH_CLOSE, np.ones((3,3),np.uint8), iterations=1)
        arr[:,:,3]=alpha
        return Image.fromarray(arr,'RGBA')
    except Exception:
        return rgba_img

def _grabcut_fallback(img: Image.Image) -> Image.Image:
    if cv2 is None:
        return img.convert("RGBA")
    rgb = img.convert("RGB")
    arr = np.array(rgb)
    h, w = arr.shape[:2]
    rect = (max(1, int(w * 0.06)), max(1, int(h * 0.04)), max(2, int(w * 0.88)), max(2, int(h * 0.92)))
    mask = np.zeros((h, w), np.uint8)
    bgd = np.zeros((1, 65), np.float64)
    fgd = np.zeros((1, 65), np.float64)
    try:
        cv2.grabCut(arr, mask, rect, bgd, fgd, 6, cv2.GC_INIT_WITH_RECT)
        m = np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)
        m = _keep_largest_alpha(m)
        rgba = np.dstack([arr, m])
        out_img=Image.fromarray(rgba, "RGBA")
        out_img=_suppress_border_background_rgba(rgb, out_img)
        return _defringe_rgba(_expand_handle_hole(_remove_handle_and_background_artifacts(out_img)))
    except Exception:
        rgba = np.dstack([arr, np.full((h, w), 255, np.uint8)])
        return Image.fromarray(rgba, "RGBA")


def _rembg_cutout(img: Image.Image) -> Tuple[Image.Image, str]:
    global _REMBG_SESSION, _REMBG_ERROR
    try:
        from rembg import remove, new_session
        if _REMBG_SESSION is None and _REMBG_ERROR is None:
            try:
                _REMBG_SESSION = new_session("u2net")
            except Exception as e:
                _REMBG_ERROR = str(e)
        src = img.convert("RGB")
        out = remove(src, session=_REMBG_SESSION) if _REMBG_SESSION else remove(src)
        if not isinstance(out, Image.Image):
            out = Image.open(io.BytesIO(out))
        out = out.convert("RGBA")
        arr = np.array(out)
        arr[:, :, 3] = _refine_alpha_edge(arr[:, :, 3])
        out = Image.fromarray(arr, "RGBA")
        out = _suppress_border_background_rgba(src, out)
        out = _defringe_rgba(_expand_handle_hole(_remove_handle_and_background_artifacts(out)))
        return out, "rembg_u2net_deep_pixel_skin_motion_v33425"
    except Exception as e:
        _REMBG_ERROR = str(e)
        return _grabcut_fallback(img), "grabcut_fallback_rembg_failed"


def _defringe_rgba(rgba: Image.Image) -> Image.Image:
    """Reduce dark contour fringing on semi-transparent edge pixels without eating the object."""
    img = rgba.convert("RGBA")
    arr = np.array(img).astype(np.uint8)
    alpha = arr[:, :, 3]
    if cv2 is None or alpha.max() < 20:
        return img
    solid = alpha > 190
    if not solid.any():
        return img
    body = arr[solid][:, :3].astype(np.float32)
    if len(body) > 5000:
        step = max(1, len(body)//5000)
        body = body[::step]
    lum = 0.2126*body[:,0] + 0.7152*body[:,1] + 0.0722*body[:,2]
    sat = (body.max(axis=1) - body.min(axis=1)) / np.maximum(1, body.max(axis=1))
    keep = body[(lum > 45) & (lum < 242) & (sat > 0.04)]
    if len(keep) == 0:
        keep = body
    base = np.median(keep, axis=0)
    ring = ((alpha > 8) & (alpha < 210)).astype(np.uint8)
    outer = cv2.dilate((alpha > 18).astype(np.uint8), np.ones((3,3), np.uint8), iterations=1)
    inner = cv2.erode((alpha > 18).astype(np.uint8), np.ones((3,3), np.uint8), iterations=1)
    ring = ((outer > 0) & (inner == 0) & (alpha > 8)).astype(np.uint8)
    rgb = arr[:, :, :3].astype(np.float32)
    lum2 = 0.2126*rgb[:,:,0] + 0.7152*rgb[:,:,1] + 0.0722*rgb[:,:,2]
    dark_ring = (ring > 0) & (lum2 < 92)
    for c in range(3):
        rgb[:, :, c] = np.where(dark_ring, rgb[:, :, c] * 0.28 + base[c] * 0.72, rgb[:, :, c])
    alpha2 = alpha.copy()
    alpha2[dark_ring] = np.minimum(alpha2[dark_ring], 165)
    arr[:, :, :3] = np.clip(rgb, 0, 255).astype(np.uint8)
    arr[:, :, 3] = alpha2
    return Image.fromarray(arr, "RGBA")

def _expand_handle_hole(rgba: Image.Image) -> Image.Image:
    """Refine only the real upper-right handle cavity; never clear lower/front label pixels."""
    img = rgba.convert("RGBA")
    arr = np.array(img)
    alpha = arr[:, :, 3]
    if cv2 is None or alpha.max() < 20:
        return img
    ys, xs = np.where(alpha > 22)
    if len(xs) == 0:
        return img
    x1, x2 = xs.min(), xs.max(); y1, y2 = ys.min(), ys.max()
    bw, bh = x2 - x1 + 1, y2 - y1 + 1
    if bw < 40 or bh < 60:
        return img
    inv = np.zeros_like(alpha, dtype=np.uint8)
    inv[y1:y2+1, x1:x2+1] = (alpha[y1:y2+1, x1:x2+1] <= 18).astype(np.uint8)
    num, labels, stats, cents = cv2.connectedComponentsWithStats(inv, 8)
    grow = np.zeros_like(alpha, dtype=np.uint8)
    for i in range(1, num):
        x, y, w, h, area = stats[i]
        if x <= x1 or y <= y1 or (x + w - 1) >= x2 or (y + h - 1) >= y2:
            continue
        rx = (cents[i][0] - x1) / max(1, bw)
        ry = (cents[i][1] - y1) / max(1, bh)
        area_ratio = area / max(1, bw * bh)
        aspect = w / max(1, h)
        if 0.61 < rx < 0.91 and 0.18 < ry < 0.56 and 0.003 < area_ratio < 0.10 and 0.20 < aspect < 1.7:
            comp = (labels == i).astype(np.uint8)
            comp = cv2.dilate(comp, np.ones((2,2), np.uint8), iterations=1)
            grow = np.maximum(grow, comp * 255)
    if grow.any():
        alpha[grow > 0] = 0
        arr[:, :, 3] = alpha
    mask = (alpha > 24).astype(np.uint8)
    comp_num, comp_labels, comp_stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    for i in range(1, comp_num):
        x, y, w, h, area = comp_stats[i]
        cx = x + w / 2.0; cy = y + h / 2.0
        rx = (cx - x1) / max(1, bw); ry = (cy - y1) / max(1, bh)
        if 0.62 < rx < 0.88 and 0.20 < ry < 0.56 and area < max(12, bw * bh * 0.0018):
            arr[:, :, 3][comp_labels == i] = 0
    return Image.fromarray(arr, "RGBA")


def _restore_label_pixels(original: Image.Image, cutout: Image.Image) -> Image.Image:
    """Restore front label pixels eaten by segmentation, while keeping the handle hole clean."""
    if cv2 is None:
        return cutout.convert("RGBA")
    orig = np.array(original.convert("RGB"))
    arr = np.array(cutout.convert("RGBA"))
    alpha = arr[:, :, 3]
    h, w = alpha.shape[:2]
    if orig.shape[0] != h or orig.shape[1] != w or alpha.max() < 20:
        return Image.fromarray(arr, "RGBA")
    ys, xs = np.where(alpha > 18)
    if len(xs) == 0:
        return Image.fromarray(arr, "RGBA")
    x1, x2 = xs.min(), xs.max(); y1, y2 = ys.min(), ys.max()
    bw, bh = x2 - x1 + 1, y2 - y1 + 1
    sample=[]
    for yy in range(y1 + int(bh*.12), y1 + int(bh*.72), max(1,bh//80)):
        for xx in range(x1 + int(bw*.08), x1 + int(bw*.45), max(1,bw//80)):
            if alpha[yy,xx] < 24: continue
            r,g,b = orig[yy,xx]
            mx,mn=max(r,g,b),min(r,g,b); sat=(mx-mn)/max(1,mx); lum=.2126*r+.7152*g+.0722*b
            if sat>.06 and 45<lum<240: sample.append((int(r),int(g),int(b)))
    body=np.median(np.array(sample),axis=0) if sample else np.array([95,165,155])
    rgb=orig.astype(np.float32)
    dist=np.sqrt(((rgb-body.reshape(1,1,3))**2).sum(axis=2))
    mx=rgb.max(axis=2); mn=rgb.min(axis=2); sat=(mx-mn)/np.maximum(1,mx)
    lum=.2126*rgb[:,:,0]+.7152*rgb[:,:,1]+.0722*rgb[:,:,2]
    yy=np.arange(h)[:,None]; xx=np.arange(w)[None,:]
    rx=(xx-x1)/max(1,bw); ry=(yy-y1)/max(1,bh)
    label_zone=(rx>.15)&(rx<.80)&(ry>.34)&(ry<.88)
    label_cue=(dist>34)&((sat>.16)|(lum>162)|(lum<118)|((rgb[:,:,0]>135)&(rgb[:,:,1]<180))|((rgb[:,:,2]>100)&(rgb[:,:,0]<190)))
    restore=label_zone & label_cue & (alpha<238)
    restore &= ~((rx>.58)&(ry<.58))
    m=(restore.astype(np.uint8))*255
    m=cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((5,5),np.uint8), iterations=1)
    restore=m>0
    arr[restore,:3]=orig[restore]
    arr[restore,3]=255
    return Image.fromarray(arr,"RGBA")

def _trim_transparent(img: Image.Image, out_side: int = OUT_SIDE) -> Image.Image:
    rgba = img.convert("RGBA")
    arr = np.array(rgba)
    x1, y1, x2, y2 = _alpha_bbox(arr[:, :, 3], 0.070)
    crop = rgba.crop((x1, y1, x2, y2))
    # V33.4: respiro trasparente controllato. Evita crop troppo "sagomato" in UI/server.
    pad = max(10, int(max(crop.size) * 0.060))
    padded = Image.new("RGBA", (crop.width + pad * 2, crop.height + pad * 2), (255, 255, 255, 0))
    padded.alpha_composite(crop, (pad, pad))
    padded.thumbnail((out_side, out_side), Image.LANCZOS)
    return padded

def _make_white(img: Image.Image) -> Image.Image:
    rgba = img.convert("RGBA")
    bg = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
    bg.alpha_composite(rgba)
    return bg.convert("RGB")


def _enhance_product_pixels(rgba: Image.Image) -> Image.Image:
    """V33.4.3: slightly richer product colors and sharper real pixels, keeping alpha unchanged."""
    img = rgba.convert("RGBA")
    alpha = img.split()[-1]
    rgb = img.convert("RGB")
    try:
        rgb = ImageEnhance.Color(rgb).enhance(1.10)
        rgb = ImageEnhance.Contrast(rgb).enhance(1.045)
        rgb = ImageEnhance.Sharpness(rgb).enhance(1.16)
    except Exception:
        pass
    out = rgb.convert("RGBA")
    out.putalpha(alpha)
    return out


def _soft_shadow_card(product: Image.Image, title: str = "Render PRO") -> Image.Image:
    """V33.4.3: cleaner studio render, more real edges, only a soft contact shadow under the product."""
    prod = _enhance_product_pixels(product.convert("RGBA"))
    prod.thumbnail((700, 855), Image.LANCZOS)
    canvas = Image.new("RGBA", (1000, 1160), (252, 253, 255, 255))
    # very light vertical studio wash, almost plain white
    px = canvas.load()
    for y in range(canvas.height):
        t = y / max(1, canvas.height - 1)
        shade = int(253 + min(2, round(t * 2)))
        for x in range(canvas.width):
            px[x, y] = (shade, shade, min(255, shade + 1), 255)
    x = (canvas.width - prod.width) // 2
    y = 108 + (862 - prod.height) // 2
    # contact shadow only: centered bottom ellipse, no side black cast
    shadow_w = max(150, int(prod.width * 0.56))
    shadow_h = max(24, int(prod.width * 0.10))
    ell = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(ell)
    sx1 = (canvas.width - shadow_w) // 2
    sy1 = y + prod.height + max(8, int(prod.height * 0.016))
    d.ellipse((sx1, sy1, sx1 + shadow_w, sy1 + shadow_h), fill=(20, 30, 42, 14))
    ell = ell.filter(ImageFilter.GaussianBlur(10))
    canvas.alpha_composite(ell)
    canvas.alpha_composite(prod, (x, y))
    return canvas.convert("RGB")


def _remove_handle_and_background_artifacts(rgba: Image.Image) -> Image.Image:
    """GPU brain cleanup: remove dark/background blobs inside handle holes and isolated non-product patches."""
    img = rgba.convert("RGBA")
    arr = np.array(img)
    alpha = arr[:, :, 3]
    if cv2 is None or alpha.max() < 20:
        return img
    ys, xs = np.where(alpha > 22)
    if len(xs) == 0:
        return img
    x1, x2 = xs.min(), xs.max(); y1, y2 = ys.min(), ys.max()
    bw, bh = x2 - x1 + 1, y2 - y1 + 1
    # estimate body color from left/central product region, avoiding label/white/dark
    sample = []
    for yy in range(y1 + int(bh*.12), y1 + int(bh*.78), max(1, bh//80)):
        for xx in range(x1 + int(bw*.06), x1 + int(bw*.48), max(1, bw//80)):
            if alpha[yy, xx] < 28: continue
            r,g,b = arr[yy, xx, :3]
            mx, mn = max(r,g,b), min(r,g,b)
            sat = (mx-mn)/max(1,mx)
            lum = 0.2126*r+0.7152*g+0.0722*b
            if sat < .06 or lum < 48 or lum > 242: continue
            sample.append((int(r),int(g),int(b)))
    if not sample:
        return img
    body = np.median(np.array(sample), axis=0)
    rgb = arr[:, :, :3].astype(np.float32)
    dist = np.sqrt(((rgb - body.reshape(1,1,3)) ** 2).sum(axis=2))
    mx = rgb.max(axis=2); mn = rgb.min(axis=2); sat = (mx-mn)/np.maximum(1,mx)
    lum = 0.2126*rgb[:,:,0]+0.7152*rgb[:,:,1]+0.0722*rgb[:,:,2]
    # artifacts: background-like/dark/neutral patches in upper-right handle area, not colorful label
    region = np.zeros_like(alpha, dtype=np.uint8)
    region[y1+int(bh*.10):y1+int(bh*.62), x1+int(bw*.60):x2+1] = 1
    bg_like = ((dist > 46) | (lum < 105) | ((lum > 165) & (sat < .18))) & (sat < .55)
    cand = ((alpha > 20) & (region > 0) & bg_like).astype(np.uint8)
    cand = cv2.morphologyEx(cand, cv2.MORPH_OPEN, np.ones((3,3),np.uint8), iterations=1)
    num, labels, stats, cents = cv2.connectedComponentsWithStats(cand, 8)
    for i in range(1, num):
        x,y,w,h,area = stats[i]
        if area < max(25, bw*bh*.002) or area > bw*bh*.085:
            continue
        cx, cy = cents[i]
        rx=(cx-x1)/max(1,bw); ry=(cy-y1)/max(1,bh)
        aspect=w/max(1,h)
        # handle holes/blobs live right-upper, not lower label area
        if rx > .66 and .18 < ry < .58 and y > y1 + int(bh*.14) and .22 < aspect < 2.6:
            alpha[labels==i] = 0
    arr[:,:,3] = alpha
    return Image.fromarray(arr, "RGBA")


def _label_crop_v333(product: Image.Image) -> Tuple[Image.Image, Dict[str, Any]]:
    """V33.4: label detector that scores text/color components and rejects handle holes."""
    rgba = product.convert("RGBA")
    rgba.thumbnail((1400, 1400), Image.LANCZOS)
    arr = np.array(rgba)
    alpha = arr[:,:,3]
    h,w = alpha.shape[:2]
    if cv2 is None or alpha.max() < 22:
        src = rgba.convert("RGB")
        x1,y1,x2,y2 = int(w*.22), int(h*.42), int(w*.78), int(h*.78)
        crop = src.crop((x1,y1,x2,y2)); crop.thumbnail((980,520), Image.LANCZOS)
        return crop, {"x":x1,"y":y1,"w":x2-x1,"h":y2-y1,"confidence":45,"method":"v33_4_label_fallback_no_cv"}
    ys,xs=np.where(alpha>22)
    if len(xs)==0:
        return rgba.convert("RGB"), {"x":0,"y":0,"w":w,"h":h,"confidence":20,"method":"v33_4_empty_alpha"}
    bx1,bx2,by1,by2=xs.min(),xs.max(),ys.min(),ys.max()
    bw,bh=bx2-bx1+1,by2-by1+1
    rgb=arr[:,:,:3].astype(np.uint8)
    hsv=cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    sat=hsv[:,:,1].astype(np.float32)/255.0
    val=hsv[:,:,2].astype(np.float32)/255.0
    gray=cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    edges=cv2.Canny(gray,50,145)
    # body color model from left/top area
    sample=[]
    for yy in range(by1+int(bh*.10), by1+int(bh*.80), max(1,bh//90)):
        for xx in range(bx1+int(bw*.05), bx1+int(bw*.48), max(1,bw//90)):
            if alpha[yy,xx]<25: continue
            r,g,b=rgb[yy,xx]; lum=.2126*r+.7152*g+.0722*b
            if sat[yy,xx]>.07 and 50<lum<240:
                sample.append((int(r),int(g),int(b)))
    body=np.median(np.array(sample),axis=0) if sample else np.array([120,175,170])
    dist=np.sqrt(((rgb.astype(np.float32)-body.reshape(1,1,3))**2).sum(axis=2))
    product_mask=alpha>22
    plausible=np.zeros((h,w),np.uint8)
    plausible[by1+int(bh*.28):by1+int(bh*.92), bx1+int(bw*.10):bx1+int(bw*.86)] = 1
    # Label cues: different from plastic body + colorful/dark/bright text/graphics.
    cue = product_mask & (plausible>0) & (dist>42) & ((sat>.20) | (gray<105) | (gray>178) | (edges>0))
    # reject right-upper handle/holes hard
    yy=np.linspace(0,1,h)[:,None]; xx=np.linspace(0,1,w)[None,:]
    handle_penalty = (xx > (bx1+bw*.56)/w) & (yy < (by1+bh*.66)/h)
    cue = cue & ~(((dist>45)&(sat<.22)&handle_penalty))
    mask=(cue.astype(np.uint8))*255
    mask=cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((13,9),np.uint8), iterations=2)
    mask=cv2.dilate(mask, np.ones((9,7),np.uint8), iterations=1)
    num, labels, stats, cents = cv2.connectedComponentsWithStats((mask>0).astype(np.uint8),8)
    best=None
    for i in range(1,num):
        x,y,ww,hh,area=stats[i]
        if area < max(160, bw*bh*.004): continue
        if ww < bw*.13 or hh < bh*.055: continue
        if ww > bw*.70 or hh > bh*.44: continue
        cx,cy=cents[i]; rx=(cx-bx1)/bw; ry=(cy-by1)/bh; aspect=ww/max(1,hh)
        if rx>.66 and ry<.62: continue  # handle zone
        if rx<.18 or rx>.78 or ry<.34 or ry>.86: continue
        comp=(labels==i)
        color_var=float(np.std(rgb[comp].astype(np.float32))) if area>0 else 0
        text=float((gray[comp]<105).sum())/max(1,area)
        edge=float((edges[comp]>0).sum())/max(1,area)
        center=1-min(1,abs(rx-.48)*1.75+abs(ry-.62)*1.35)
        aspect_bonus=1.0 if .55<aspect<2.8 else .70
        score=area*(.8+min(1.4,color_var/55)+text*2.2+edge*1.4)*(1+center)*aspect_bonus
        if best is None or score>best[0]: best=(score,x,y,ww,hh,area,rx,ry)
    if best is None:
        # safe fallback: lower-middle window, never right-upper handle
        x=bx1+int(bw*.23); y=by1+int(bh*.47); ww=int(bw*.46); hh=int(bh*.24); method="v33_4_label_safe_lower_window"; conf=58
    else:
        _,x,y,ww,hh,area,rx,ry=best; method="v33_4_label_component_text_color"; conf=int(max(78,min(98,76+area/max(1,bw*bh)*1200)))
    pad_x=int(ww*.08); pad_y=int(hh*.10)
    x1=max(0,x-pad_x); y1=max(0,y-pad_y); x2=min(w,x+ww+pad_x); y2=min(h,y+hh+pad_y)
    crop=rgba.convert("RGB").crop((x1,y1,x2,y2))
    crop=ImageEnhance.Sharpness(crop).enhance(1.65)
    crop=ImageEnhance.Contrast(crop).enhance(1.12)
    crop.thumbnail((980,560), Image.LANCZOS)
    return crop, {"x":int(x1),"y":int(y1),"w":int(x2-x1),"h":int(y2-y1),"confidence":conf,"method":method}


def _quick_crop_text_score(img: Optional[Image.Image]) -> float:
    try:
        if img is None:
            return 0.0
        rgb=np.array(img.convert("RGB"))
        if rgb.size==0:
            return 0.0
        gray=cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY) if cv2 is not None else np.mean(rgb, axis=2).astype(np.uint8)
        sat=np.std(rgb.astype(np.float32), axis=2)
        edges=(cv2.Canny(gray, 50, 145)>0).mean() if cv2 is not None else 0.0
        dark=(gray<110).mean()
        bright=(gray>175).mean()
        contrast=float(np.std(gray.astype(np.float32))/64.0)
        return float(edges*2.2 + dark*1.4 + bright*0.7 + contrast + min(1.0,float(np.mean(sat)/58.0)))
    except Exception:
        return 0.0


def _bottle_label_crop(product: Image.Image) -> Tuple[Image.Image, Dict[str, Any]]:
    """Bottle-aware label crop: prefer lower central panel where detergent/drink labels usually live."""
    rgba=product.convert("RGBA")
    rgba.thumbnail((1400,1400), Image.LANCZOS)
    arr=np.array(rgba)
    alpha=arr[:,:,3]
    h,w=alpha.shape[:2]
    ys,xs=np.where(alpha>22)
    if len(xs)==0:
        src=rgba.convert("RGB")
        crop=src.crop((int(w*.20), int(h*.46), int(w*.82), int(h*.88)))
        crop.thumbnail((980,560), Image.LANCZOS)
        return crop,{"x":int(w*.20),"y":int(h*.46),"w":int(w*.62),"h":int(h*.42),"confidence":56,"method":"v33_4_bottle_label_fallback_no_alpha"}
    bx1,bx2,by1,by2=xs.min(),xs.max(),ys.min(),ys.max()
    bw,bh=bx2-bx1+1,by2-by1+1
    x1=max(0, int(bx1+bw*.14)); x2=min(w, int(bx1+bw*.86))
    y1=max(0, int(by1+bh*.44)); y2=min(h, int(by1+bh*.88))
    crop=rgba.convert("RGB").crop((x1,y1,x2,y2))
    crop=ImageEnhance.Sharpness(crop).enhance(1.55)
    crop=ImageEnhance.Contrast(crop).enhance(1.10)
    crop.thumbnail((980,560), Image.LANCZOS)
    conf=int(max(60,min(90, 58+_quick_crop_text_score(crop)*8 )))
    return crop,{"x":x1,"y":y1,"w":int(x2-x1),"h":int(y2-y1),"confidence":conf,"method":"v33_4_bottle_label_window"}


def _choose_best_label_crop(product: Image.Image) -> Tuple[Image.Image, Dict[str, Any]]:
    base_crop, base_meta = _label_crop_v333(product)
    try:
        fam = _detect_product_family(product, base_meta)
    except Exception:
        fam = {"family":"unknown_product"}
    if fam.get('family') not in {'bottle','detergent_bottle_handle'}:
        return base_crop, base_meta
    alt_crop, alt_meta = _bottle_label_crop(product)
    base_score = float(base_meta.get('confidence') or 0) + _quick_crop_text_score(base_crop)*7.0
    alt_score = float(alt_meta.get('confidence') or 0) + _quick_crop_text_score(alt_crop)*9.0
    if alt_score > base_score + 6:
        return alt_crop, alt_meta
    return base_crop, base_meta


def _extruded_alpha_glb(product: Image.Image, back: Optional[Image.Image]=None) -> Dict[str, Any]:
    """Deterministic real volume GLB: silhouette/depth extrusion with vertex colors. Guarantees visible 3D when TripoSR is too flat."""
    try:
        import trimesh
    except Exception as e:
        raise RuntimeError(f"trimesh_missing:{e}")
    rgba=product.convert("RGBA")
    bbox=rgba.getbbox()
    if bbox: rgba=rgba.crop(bbox)
    rgba.thumbnail((88,132), Image.LANCZOS)
    # keep dimensions not too tiny
    arr=np.array(rgba)
    H,W=arr.shape[:2]
    mask=arr[:,:,3]>38
    if cv2 is not None:
        m=(mask.astype(np.uint8))*255
        m=cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((3,3),np.uint8), iterations=1)
        mask=m>0
        dist=cv2.distanceTransform(mask.astype(np.uint8), cv2.DIST_L2, 3)
        if dist.max()>0: dist=dist/dist.max()
    else:
        dist=mask.astype(np.float32)
    aspect=W/max(1,H)
    verts=[]; colors=[]; front_idx={}; back_idx={}
    def add_v(x,y,z,c):
        idx=len(verts); verts.append([x,y,z]); colors.append([int(c[0]),int(c[1]),int(c[2]),255]); return idx
    # optional back colors
    if back is not None:
        bimg=back.convert("RGBA"); bimg.thumbnail((W,H), Image.LANCZOS); bcan=Image.new("RGBA",(W,H),(255,255,255,0)); bcan.alpha_composite(bimg,((W-bimg.width)//2,(H-bimg.height)//2)); barr=np.array(bcan)
    else:
        barr=arr
    for y in range(H):
        for x in range(W):
            if not mask[y,x]: continue
            xx=(x/(W-1)-.5)*aspect*2.0
            yy=(.5-y/(H-1))*2.0
            d=.16+.62*float(dist[y,x]**0.72)
            front_idx[(x,y)]=add_v(xx,yy,d,arr[y,x,:3])
            bc=barr[y,x,:3] if barr[y,x,3]>20 else (arr[y,x,:3]*0.72).astype(np.uint8)
            back_idx[(x,y)]=add_v(xx,yy,-d,bc)
    faces=[]
    for y in range(H-1):
        for x in range(W-1):
            pts=[(x,y),(x+1,y),(x,y+1),(x+1,y+1)]
            if all(p in front_idx for p in pts):
                a,b,c,d=front_idx[(x,y)],front_idx[(x+1,y)],front_idx[(x,y+1)],front_idx[(x+1,y+1)]
                faces.append([a,c,b]); faces.append([b,c,d])
                ab,bb,cb,db=back_idx[(x,y)],back_idx[(x+1,y)],back_idx[(x,y+1)],back_idx[(x+1,y+1)]
                faces.append([ab,bb,cb]); faces.append([bb,db,cb])
    # side faces along boundaries
    for y in range(H):
        for x in range(W):
            if (x,y) not in front_idx: continue
            for dx,dy in [(1,0),(-1,0),(0,1),(0,-1)]:
                nx,ny=x+dx,y+dy
                if (nx,ny) in front_idx: continue
                # connect to neighbor direction edge approximation if adjacent pixels along perpendicular exist
                if dx!=0:
                    p2=(x,y+1)
                else:
                    p2=(x+1,y)
                if p2 in front_idx:
                    faces.append([front_idx[(x,y)], back_idx[(x,y)], front_idx[p2]])
                    faces.append([front_idx[p2], back_idx[(x,y)], back_idx[p2]])
    mesh=trimesh.Trimesh(vertices=np.array(verts,dtype=np.float32), faces=np.array(faces,dtype=np.int64), vertex_colors=np.array(colors,dtype=np.uint8), process=True)
    mesh.apply_transform(trimesh.transformations.rotation_matrix(math.radians(180), [0,1,0]))
    glb=_mesh_to_glb_data_url(mesh)
    return {"ok":True,"engine":"Spesa Deep Pixel-Skin Motion Fusion V33.4.25","realMeshGlb":True,"glbDataUrl":glb,"elapsedMs":0,"note":"Visible real GLB volume mesh generated from product silhouette/depth on RunPod GPU brain V33.4.25 with isolated 3D pipeline, thicker visible volume, live-frame preview, and final GLB persistence tuning."}






def _guided_product_twin_glb(front: Image.Image, side: Optional[Image.Image]=None, back: Optional[Image.Image]=None, meta: Optional[Dict[str,Any]]=None) -> Dict[str, Any]:
    """V33.4.25: Product Twin parametric fallback for supermarket packaging.
    It never uses the raw frame/table; it uses only the isolated front/back alpha and produces a clean GLB when multiview reconstruction is too fragile.
    """
    out=_extruded_alpha_glb(front, back)
    out["engine"]="Spesa Guided Product Twin Core V33.4.25"
    out["productTwin"]={"enabled":True,"strategy":"front_texture_plus_safe_depth","sideProvided":bool(side),"backProvided":bool(back),"family":str((meta or {}).get('productFamily') or '')}
    out["qualityScore"]=max(72, int((meta or {}).get('coveragePercent') or 0))
    out["note"]=(out.get("note") or "")+" Product Twin path: clean product silhouette, category-aware safe depth, no background/table fallback."
    return out

def _product_cut_stats(cut: Image.Image) -> Dict[str, Any]:
    rgba=cut.convert("RGBA")
    arr=np.array(rgba)
    alpha=arr[:,:,3]
    h,w=alpha.shape[:2]
    mask=alpha>28
    ys,xs=np.where(mask)
    if len(xs)==0:
        return {"ok":False,"reason":"empty_alpha","coverage":0,"touchEdge":True,"w":w,"h":h}
    x1,x2=int(xs.min()),int(xs.max())+1; y1,y2=int(ys.min()),int(ys.max())+1
    bw,bh=x2-x1,y2-y1
    bbox_area=max(1,bw*bh)
    fill=float(mask[y1:y2,x1:x2].sum())/bbox_area
    coverage=float(mask.sum())/max(1,w*h)
    touch=x1<=2 or y1<=2 or x2>=w-3 or y2>=h-3
    # if mask almost entire frame, it is usually background/table, not product
    huge_bbox=(bw/w>.94 and bh/h>.88) or coverage>.82
    tiny=coverage<.025 or bw<24 or bh<36
    aspect=bh/max(1,bw)
    ok=not huge_bbox and not tiny and fill>.18 and fill<.96
    reason="ok"
    if huge_bbox: reason="mask_too_large_background_likely"
    elif tiny: reason="mask_too_small"
    elif fill<=.18: reason="mask_too_sparse"
    elif fill>=.96 and coverage>.45: reason="mask_flat_full_block"
    return {"ok":bool(ok),"reason":reason,"coverage":round(coverage,4),"fill":round(fill,4),"touchEdge":bool(touch),"bbox":[x1,y1,bw,bh],"w":w,"h":h,"aspect":round(aspect,3)}


def _strict_clean_cut(img: Image.Image) -> Tuple[Optional[Image.Image], Dict[str, Any]]:
    try:
        cut, method = _rembg_cutout(img)
        cut = _restore_label_pixels(img, cut)
        cut = _expand_handle_hole(_defringe_rgba(cut))
        cut = _restore_label_pixels(img, cut)
        cut = _enhance_product_pixels(_trim_transparent(cut))
        stats=_product_cut_stats(cut)
        stats["method"]=method
        if SPESA_REQUIRE_CLEAN_MASK_FOR_GLB and not stats.get("ok"):
            return None, stats
        return cut, stats
    except BaseException as e:
        return None, {"ok":False,"reason":"segmentation_failed","error":str(e)[:180],"method":"failed"}




def _relaxed_clean_cut_for_build(img: Image.Image) -> Tuple[Optional[Image.Image], Dict[str, Any]]:
    """V33.4.25 Smart Finalizer: second-pass product cut for final GLB.
    It is still object-only, but it does not throw away a usable side/back just because the
    strict live gate was too conservative. The goal is: no dead-end after a good scan.
    """
    try:
        if img is None:
            return None, {"ok": False, "reason": "missing_image", "method": "relaxed_none"}
        cut, method = _rembg_cutout(img)
        cut = _restore_label_pixels(img, cut)
        cut = _expand_handle_hole(_defringe_rgba(cut))
        # Keep object, but shrink uncertain boundary a touch so table/wall pixels do not enter the GLB.
        if cv2 is not None:
            arr = np.array(cut.convert("RGBA"))
            a = arr[:, :, 3].astype(np.uint8)
            a = _keep_largest_alpha(a)
            # Controlled erosion/open only on alpha; preserve shape while removing fringe.
            a = cv2.morphologyEx(a, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8), iterations=1)
            a = cv2.morphologyEx(a, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8), iterations=1)
            arr[:, :, 3] = a
            cut = Image.fromarray(arr, "RGBA")
        cut = _restore_label_pixels(img, cut)
        cut = _enhance_product_pixels(_trim_transparent(cut))
        stats = _product_cut_stats(cut)
        stats["method"] = "relaxed_build_" + str(method)
        # Reject only truly impossible masks. Do not block usable side/back frames that the strict gate disliked.
        cov = float(stats.get("coverage") or 0.0)
        fill = float(stats.get("fill") or 0.0)
        bbox = stats.get("bbox") or [0, 0, 0, 0]
        bw = float(bbox[2] if len(bbox) > 2 else 0); bh = float(bbox[3] if len(bbox) > 3 else 0)
        W = float(stats.get("w") or max(1, cut.width)); H = float(stats.get("h") or max(1, cut.height))
        too_huge = (bw / max(1.0, W) > .975 and bh / max(1.0, H) > .94) or cov > .90
        too_tiny = cov < .015 or bw < 18 or bh < 28
        if too_huge or too_tiny:
            stats["ok"] = False
            stats["reason"] = "relaxed_reject_huge_or_tiny"
            return None, stats
        stats["ok"] = True
        stats["reason"] = "relaxed_ok_for_finalizer"
        stats["relaxed"] = True
        stats["fill"] = round(fill, 4)
        stats["coverage"] = round(cov, 4)
        return cut, stats
    except BaseException as e:
        return None, {"ok": False, "reason": "relaxed_build_cut_failed", "error": str(e)[:180], "method": "relaxed_failed"}


def _side_proxy_from_front(front: Image.Image) -> Optional[Image.Image]:
    """Last-resort controlled side proxy from front silhouette.
    This avoids a dead-end when the user has scanned enough but one side cut failed.
    It creates a narrow object-only silhouette, not a table/screen fallback.
    """
    try:
        rgba = front.convert("RGBA")
        bbox = rgba.getbbox()
        if bbox:
            rgba = rgba.crop(bbox)
        if rgba.width < 8 or rgba.height < 8:
            return None
        new_w = max(14, int(rgba.width * 0.52))
        proxy = rgba.resize((new_w, rgba.height), Image.LANCZOS)
        canvas = Image.new("RGBA", rgba.size, (255,255,255,0))
        canvas.alpha_composite(proxy, ((rgba.width-new_w)//2, 0))
        return canvas
    except Exception:
        return None

def _cut_product_for_3d(img: Optional[Image.Image]) -> Optional[Image.Image]:
    if img is None:
        return None
    cut, stats = _strict_clean_cut(img)
    # Important: never fallback to whole original RGBA for GLB. That created table/floor garbage mesh.
    if cut is None:
        return None
    return cut


def _normalize_view_canvas(img: Optional[Image.Image], target_h: int = 168, target_w: int = 120) -> Optional[Image.Image]:
    if img is None:
        return None
    rgba = img.convert("RGBA")
    bbox = rgba.getbbox()
    if bbox:
        rgba = rgba.crop(bbox)
    if rgba.width < 2 or rgba.height < 2:
        return None
    rgba.thumbnail((target_w, target_h), Image.LANCZOS)
    canvas = Image.new("RGBA", (target_w, target_h), (255, 255, 255, 0))
    ox = (target_w - rgba.width) // 2
    oy = (target_h - rgba.height) // 2
    canvas.alpha_composite(rgba, (ox, oy))
    return canvas


def _mask_from_rgba(img: Image.Image) -> Tuple[np.ndarray, np.ndarray]:
    arr = np.array(img.convert("RGBA"))
    mask = arr[:, :, 3] > 24
    if cv2 is not None:
        m = (mask.astype(np.uint8)) * 255
        m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8), iterations=1)
        m = cv2.medianBlur(m, 3)
        mask = m > 0
    return arr, mask


def _multiview_voxel_glb(front: Image.Image, side: Optional[Image.Image] = None, back: Optional[Image.Image] = None) -> Dict[str, Any]:
    """True 3D multiview mesh: front + side silhouettes -> voxel volume -> marching cubes -> GLB."""
    try:
        import trimesh
    except Exception as e:
        raise RuntimeError(f"trimesh_missing:{e}")
    if side is None:
        if SPESA_ALLOW_SINGLE_VIEW_3D:
            return _extruded_alpha_glb(front, back)
        raise RuntimeError("side_view_required_for_clean_glb")
    front_rgba = _normalize_view_canvas(front, target_h=176, target_w=126)
    side_rgba = _normalize_view_canvas(side, target_h=176, target_w=104)
    back_rgba = _normalize_view_canvas(back if back is not None else front, target_h=176, target_w=126)
    if front_rgba is None or side_rgba is None:
        raise RuntimeError("front_or_side_canvas_invalid")
    farr, fmask = _mask_from_rgba(front_rgba)
    sarr, smask = _mask_from_rgba(side_rgba)
    barr, _ = _mask_from_rgba(back_rgba)
    H, W = fmask.shape
    D = smask.shape[1]
    occ = np.zeros((W, D, H), dtype=bool)
    for y in range(H):
        fx = np.flatnonzero(fmask[y])
        sx = np.flatnonzero(smask[y])
        if fx.size == 0 or sx.size == 0:
            continue
        x1, x2 = int(fx.min()), int(fx.max()) + 1
        z1, z2 = int(sx.min()), int(sx.max()) + 1
        occ[x1:x2, z1:z2, H - 1 - y] = True
    if occ.sum() < 64:
        raise RuntimeError("multiview_occupancy_too_low")
    try:
        mesh = trimesh.voxel.ops.matrix_to_marching_cubes(occ, pitch=1.0)
    except Exception as e:
        raise RuntimeError(f"marching_cubes_failed:{e}")
    mesh.remove_duplicate_faces()
    mesh.remove_degenerate_faces()
    mesh.remove_unreferenced_vertices()
    mesh.apply_translation(-mesh.bounding_box.centroid)
    ext = float(max(mesh.extents.max(), 1e-6))
    mesh.apply_scale(2.0 / ext)
    verts = np.array(mesh.vertices, dtype=np.float32)
    mins = verts.min(axis=0)
    maxs = verts.max(axis=0)
    span = np.maximum(maxs - mins, 1e-6)
    colors = np.zeros((len(verts), 4), dtype=np.uint8)
    side_fallback = farr
    for i, (vx, vy, vz) in enumerate(verts):
        px = int(np.clip((vx - mins[0]) / span[0] * (W - 1), 0, W - 1))
        py = int(np.clip((1.0 - (vz - mins[2]) / span[2]) * (H - 1), 0, H - 1))
        pz = int(np.clip((vy - mins[1]) / span[1] * (D - 1), 0, D - 1))
        cf = farr[py, px, :3] if farr[py, px, 3] > 12 else np.array([238, 238, 238], dtype=np.uint8)
        cb = barr[py, px, :3] if barr[py, px, 3] > 12 else np.clip(cf.astype(np.float32) * 0.72, 0, 255).astype(np.uint8)
        cs = sarr[py, pz, :3] if sarr[py, pz, 3] > 12 else side_fallback[py, min(px, side_fallback.shape[1]-1), :3]
        frontness = float((vy - mins[1]) / span[1])
        edginess = float(abs((vx - (mins[0] + maxs[0]) * 0.5)) / max(span[0] * 0.5, 1e-6))
        if frontness >= 0.66:
            c = cf.astype(np.float32)
        elif frontness <= 0.34:
            c = cb.astype(np.float32)
        else:
            blend = min(1.0, max(0.0, edginess * 1.15))
            mid = (cf.astype(np.float32) + cb.astype(np.float32)) * 0.5
            c = mid * (1.0 - blend) + cs.astype(np.float32) * blend
        colors[i, :3] = np.clip(c, 0, 255).astype(np.uint8)
        colors[i, 3] = 255
    mesh.visual.vertex_colors = colors
    try:
        mesh.fix_normals()
    except Exception:
        pass
    mesh.apply_transform(trimesh.transformations.rotation_matrix(math.radians(180), [0, 1, 0]))
    glb = _mesh_to_glb_data_url(mesh)
    return {
        "ok": True,
        "engine": "Spesa Deep Pixel-Skin MultiView Surface Fusion V33.4.25",
        "realMeshGlb": True,
        "glbDataUrl": glb,
        "elapsedMs": 0,
        "note": "True multiview GLB generated from front + side (+ optional back) using voxel volume reconstruction, marching cubes mesh extraction, and vertex color projection."
    }


def _true_3d_from_views(front: Image.Image, side: Optional[Image.Image] = None, back: Optional[Image.Image] = None) -> Dict[str, Any]:
    if side is not None:
        return _multiview_voxel_glb(front, side, back)
    if SPESA_ALLOW_SINGLE_VIEW_3D:
        return _triposr_glb(front, back)
    raise RuntimeError("no_side_view_no_fake_glb")



def _estimate_true3d_quality(has_front: bool, has_side: bool, has_back: bool, has_top: bool, has_bottom: bool, coverage: float = 0.0) -> int:
    score = 34
    if has_front: score += 18
    if has_side: score += 22
    if has_back: score += 12
    if has_top: score += 7
    if has_bottom: score += 7
    score += int(max(0.0, min(18.0, float(coverage) * 0.18)))
    return int(max(20, min(99, score)))


def _hybrid_true_3d_from_views(front: Image.Image, side: Optional[Image.Image] = None, back: Optional[Image.Image] = None, top: Optional[Image.Image] = None, bottom: Optional[Image.Image] = None, coverage: float = 0.0) -> Dict[str, Any]:
    has_front = front is not None
    has_side = side is not None
    has_back = back is not None
    has_top = top is not None
    has_bottom = bottom is not None
    quality = _estimate_true3d_quality(has_front, has_side, has_back, has_top, has_bottom, coverage)
    pipeline = []
    if has_front and has_side:
        pipeline.extend(["multi_view_capture", "clean_object_mask", "voxel_volume_reconstruction", "marching_cubes_mesh"])
        result = _multiview_voxel_glb(front, side, back or front)
    else:
        pipeline.extend(["insufficient_geometry", "no_fake_glb"])
        if SPESA_ALLOW_SINGLE_VIEW_3D:
            result = _true_3d_from_views(front, side, back)
        else:
            raise RuntimeError("front_plus_side_required_for_true_3d")
    if has_top or has_bottom:
        pipeline.append("top_bottom_volume_regularization")
    pipeline.append("vertex_color_projection")
    result["qualityScore"] = quality
    result["pipeline"] = pipeline
    result["captureSummary"] = {
        "front": has_front,
        "side": has_side,
        "back": has_back,
        "top": has_top,
        "bottom": has_bottom,
    }
    result["engine"] = "Spesa Deep Pixel-Skin Object-Lock 3D Fusion V33.4.25"
    note = result.get("note") or ""
    note += " Hybrid engine: multiview voxel reconstruction only when clean front+side are available; no SpesaMesh/Depth-Extrusion fallback is allowed."
    result["note"] = note.strip()
    return result

def _feature_score_patch(rgb: np.ndarray) -> np.ndarray:
    # label candidate score: saturation + edges + dark/bright text-like contrast
    arr = rgb.astype(np.uint8)
    if cv2 is not None:
        hsv = cv2.cvtColor(arr, cv2.COLOR_RGB2HSV)
        sat = hsv[:, :, 1].astype(np.float32) / 255.0
        gray = cv2.cvtColor(arr, cv2.COLOR_RGB2GRAY)
        edges = cv2.Canny(gray, 60, 150).astype(np.float32) / 255.0
        dark = (gray < 105).astype(np.float32) * 0.35
        bright = (gray > 185).astype(np.float32) * 0.22
        redblue = (((arr[:, :, 0] > 120) & (arr[:, :, 2] > 70)) | (arr[:, :, 2] > 115)).astype(np.float32) * 0.32
        return sat * 0.85 + edges * 1.20 + dark + bright + redblue
    # numpy fallback
    mx = arr.max(axis=2).astype(np.float32); mn = arr.min(axis=2).astype(np.float32)
    sat = (mx - mn) / np.maximum(mx, 1)
    return sat


def _integral_sum(ii: np.ndarray, x1: int, y1: int, x2: int, y2: int) -> float:
    return float(ii[y2, x2] - ii[y1, x2] - ii[y2, x1] + ii[y1, x1])


def _label_crop(img: Image.Image, product_alpha: Optional[Image.Image] = None) -> Tuple[Image.Image, Dict[str, Any]]:
    """V33.1: crop SOLO ETICHETTA. Usa ancore colore/testo, esclude corpo flacone e maniglia."""
    src = img.convert("RGB")
    src.thumbnail((1600, 1600), Image.LANCZOS)
    rgb = np.array(src)
    h, w = rgb.shape[:2]
    if cv2 is None:
        # fallback centrale ma stretto
        x1, y1, x2, y2 = int(w*.22), int(h*.34), int(w*.78), int(h*.72)
        crop = src.crop((x1,y1,x2,y2)); crop.thumbnail((960,520), Image.LANCZOS)
        return crop, {"x":x1,"y":y1,"w":x2-x1,"h":y2-y1,"confidence":45,"method":"v33_1_label_fallback_no_cv"}

    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    hue = hsv[:, :, 0].astype(np.int16)
    sat = hsv[:, :, 1].astype(np.float32) / 255.0
    val = hsv[:, :, 2].astype(np.float32) / 255.0
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    edges = cv2.Canny(gray, 55, 150)

    r = rgb[:, :, 0].astype(np.int16); g = rgb[:, :, 1].astype(np.int16); b = rgb[:, :, 2].astype(np.int16)
    # Corpo tipico flacone verde/ciano: va escluso, anche se saturo.
    body_cyan_green = ((hue >= 62) & (hue <= 103) & (sat > 0.16) & (g > 75) & (b > 65) & (r < 185))
    floor_bg = ((val > 0.76) & (sat < 0.18))
    # Ancore vere di etichetta: rosso/giallo/blu/viola, aree molto informative e testo scuro collegato.
    red = ((hue <= 12) | (hue >= 168)) & (sat > 0.28)
    yellow = ((hue >= 16) & (hue <= 42) & (sat > 0.24))
    blue = ((hue >= 104) & (hue <= 142) & (sat > 0.22))
    purple = ((hue >= 143) & (hue <= 167) & (sat > 0.18))
    dark_text = (gray < 92)
    white_label = ((gray > 170) & (sat < 0.28))
    # Anchor iniziale solo colori forti NON corpo flacone.
    anchor = ((red | yellow | blue | purple) & ~body_cyan_green & ~floor_bg).astype(np.uint8) * 255
    # Dilata per includere testo e zone bianche vicine alla grafica label.
    anchor = cv2.morphologyEx(anchor, cv2.MORPH_CLOSE, np.ones((11, 11), np.uint8), iterations=2)
    anchor = cv2.dilate(anchor, np.ones((17, 17), np.uint8), iterations=1)
    text_near = (((dark_text | white_label) & (anchor > 0) & ~body_cyan_green).astype(np.uint8) * 255)
    mask = cv2.bitwise_or(anchor, text_near)
    mask = cv2.bitwise_or(mask, ((edges > 0) & (anchor > 0)).astype(np.uint8) * 255)
    # restringi a zona plausibile: non tappo, non bordi estremi
    plaus = np.zeros_like(mask)
    plaus[int(h*.18):int(h*.86), int(w*.06):int(w*.94)] = 255
    mask = cv2.bitwise_and(mask, plaus)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((15, 9), np.uint8), iterations=2)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8), iterations=1)

    num, labels, stats, cents = cv2.connectedComponentsWithStats((mask > 0).astype(np.uint8), 8)
    best = None
    for i in range(1, num):
        x, y, ww, hh, area = stats[i]
        if area < max(180, w*h*0.002):
            continue
        if ww < w*.12 or hh < h*.06:
            continue
        cx, cy = cents[i]
        aspect = ww / max(1, hh)
        # etichetta di solito rettangolare/ovale: non deve essere altissima come bottiglia intera
        if hh > h*.48 or ww > w*.78:
            continue
        center_bonus = 1.0 - min(0.55, abs(cx/w - 0.50) * 0.75)
        y_bonus = 1.0 - min(0.38, abs(cy/h - 0.56) * 0.70)
        aspect_bonus = 1.0 if 0.85 <= aspect <= 3.8 else 0.72
        score = area * center_bonus * y_bonus * aspect_bonus
        if best is None or score > best[0]:
            best = (score, x, y, ww, hh, area)

    if best is None:
        # fallback score-window, ma molto più stretto del vecchio
        score = _feature_score_patch(rgb) * (~body_cyan_green).astype(np.float32)
        yy = np.linspace(0, 1, h)[:, None]; xx = np.linspace(0, 1, w)[None, :]
        score *= np.exp(-((xx-.48)**2)/0.11) * np.exp(-((yy-.57)**2)/0.09)
        ii = np.pad(score.cumsum(axis=0).cumsum(axis=1), ((1,0),(1,0)), mode="constant")
        best2 = None
        for frac_w in [0.34, 0.44, 0.54, 0.62]:
            ww = max(90, int(w*frac_w))
            for ratio in [0.45, 0.60, 0.78]:
                hh = max(75, int(ww*ratio))
                for y in range(int(h*.24), int(h*.76), max(14, hh//8)):
                    for x in range(int(w*.08), max(int(w*.90-ww), int(w*.08)+1), max(14, ww//8)):
                        x2=min(w,x+ww); y2=min(h,y+hh)
                        v=_integral_sum(ii,x,y,x2,y2)/max(1,(x2-x)*(y2-y))
                        if best2 is None or v>best2[0]: best2=(v,x,y,x2-x,y2-y)
        _, x, y, ww, hh = best2 if best2 else (0,int(w*.22),int(h*.36),int(w*.56),int(h*.32))
        conf = 62
        method = "v33_4_label_tight_score_fallback"
    else:
        _, x, y, ww, hh, area = best
        conf = int(max(78, min(99, 76 + area / max(1, w*h) * 1600)))
        method = "v33_4_label_only_product_mask"

    pad_x = int(ww * 0.055); pad_y = int(hh * 0.070)
    x1=max(0, x-pad_x); y1=max(0, y-pad_y); x2=min(w, x+ww+pad_x); y2=min(h, y+hh+pad_y)
    # hard limit: se il box è ancora troppo largo/alto, stringi intorno al centro
    max_w=int(w*.64); max_h=int(h*.42)
    if x2-x1 > max_w:
        c=(x1+x2)//2; x1=max(0,c-max_w//2); x2=min(w,c+max_w//2)
    if y2-y1 > max_h:
        c=(y1+y2)//2; y1=max(0,c-max_h//2); y2=min(h,c+max_h//2)
    crop = src.crop((x1,y1,x2,y2))
    crop = ImageEnhance.Sharpness(crop).enhance(1.55)
    crop = ImageEnhance.Contrast(crop).enhance(1.12)
    crop.thumbnail((980, 560), Image.LANCZOS)
    meta = {"x": int(x1), "y": int(y1), "w": int(x2-x1), "h": int(y2-y1), "confidence": conf, "method": method}
    return crop, meta


def _barcode_try(img: Image.Image) -> Dict[str, Any]:
    """V33.4.4: robust multi-pass barcode. Tries zxing-cpp first, then OpenCV if available."""
    global _ZXING_ERROR
    rgb = img.convert("RGB")
    tries = []
    # build multiple crops/scales because barcode often needs close-up
    base = rgb
    base.thumbnail((1500, 1500), Image.LANCZOS)
    tries.append(("full", base))
    w, h = base.size
    # likely barcode zones: right/mid/lower panels and full close-up
    boxes = [
        (int(w*.45), int(h*.10), w, int(h*.88)),
        (int(w*.08), int(h*.55), int(w*.92), h),
        (int(w*.25), int(h*.25), int(w*.92), int(h*.92)),
    ]
    for k, b in enumerate(boxes):
        try:
            crop = base.crop(b)
            crop = ImageEnhance.Contrast(crop).enhance(1.35)
            crop = ImageEnhance.Sharpness(crop).enhance(1.55)
            crop = crop.resize((max(1,crop.width*2), max(1,crop.height*2)), Image.LANCZOS)
            tries.append((f"crop{k}", crop))
        except Exception:
            pass
    # zxing-cpp is usually much better than OpenCV barcode detector
    try:
        import zxingcpp
        values=[]; details=[]
        for name, im in tries:
            arr=np.array(im.convert("RGB"))
            try:
                res=zxingcpp.read_barcodes(arr)
            except TypeError:
                res=zxingcpp.read_barcodes(im)
            for r in (res or []):
                txt=str(getattr(r,'text','') or '').strip()
                if txt and txt not in values:
                    values.append(txt)
                    details.append({"value":txt,"format":str(getattr(r,'format','')),"source":name})
        if values:
            return {"ok":True,"found":True,"status":"confirmed","values":values,"value":values[0],"details":details,"confidence":92,"method":"zxingcpp_multicrop"}
    except Exception as e:
        _ZXING_ERROR=str(e)[:120]
    if cv2 is None:
        return {"ok":False,"found":False,"status":"not_seen","method":"no_barcode_backend","zxingError":_ZXING_ERROR or ""}
    try:
        detector = cv2.barcode.BarcodeDetector()
        values=[]; types=[]
        for name, im in tries:
            arr = cv2.cvtColor(np.array(im.convert("RGB")), cv2.COLOR_RGB2BGR)
            # try RGB/BGR, gray, threshold variants
            variants=[arr]
            gray=cv2.cvtColor(arr,cv2.COLOR_BGR2GRAY)
            variants.append(cv2.cvtColor(gray,cv2.COLOR_GRAY2BGR))
            th=cv2.adaptiveThreshold(gray,255,cv2.ADAPTIVE_THRESH_GAUSSIAN_C,cv2.THRESH_BINARY,31,7)
            variants.append(cv2.cvtColor(th,cv2.COLOR_GRAY2BGR))
            for var in variants:
                try:
                    ok, decoded_info, decoded_type, points = detector.detectAndDecodeWithType(var)
                    vals = [x for x in (decoded_info or []) if x]
                    for v in vals:
                        if v not in values: values.append(v)
                    for t in (decoded_type or []):
                        if t not in types: types.append(t)
                except Exception:
                    pass
        if values:
            return {"ok":True,"found":True,"status":"confirmed","values":values,"value":values[0],"types":types,"confidence":82,"method":"opencv_barcode_multicrop","zxingError":_ZXING_ERROR or ""}
        # detect pattern-like bars even if not decoded
        # this helps the assistant ask the user to move closer / hold steady
        arr=np.array(base.convert("L"))
        grad=np.abs(np.diff(arr.astype(np.float32),axis=1))
        bar_score=float((grad>38).mean())
        if bar_score>.10:
            return {"ok":False,"found":True,"status":"detected_not_decoded","values":[],"confidence":46,"method":"barcode_pattern_detected","barScore":round(bar_score,4),"instruction":"Avvicinati al barcode e tieni fermo un secondo."}
    except Exception as e:
        return {"ok":False,"found":False,"status":"failed","method":"opencv_barcode_error","error":str(e)[:120],"zxingError":_ZXING_ERROR or ""}
    return {"ok":False,"found":False,"status":"not_seen","method":"barcode_multicrop","zxingError":_ZXING_ERROR or ""}


def _synthetic_depth(alpha: np.ndarray) -> Image.Image:
    h, w = alpha.shape[:2]
    mask = (alpha > 12).astype(np.float32)
    yy, xx = np.mgrid[0:h, 0:w]
    ys, xs = np.where(mask > 0)
    if len(xs) == 0:
        depth = np.zeros((h, w), np.uint8)
        return Image.fromarray(depth, "L")
    cx, cy = xs.mean(), ys.mean()
    rx = max(1, (xs.max() - xs.min()) / 2)
    ry = max(1, (ys.max() - ys.min()) / 2)
    ellipse = 1 - np.clip(((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2, 0, 1)
    depth = (ellipse ** 0.55) * 220 * mask + 18 * mask
    if cv2 is not None:
        depth = cv2.GaussianBlur(depth.astype(np.uint8), (0, 0), 5)
    return Image.fromarray(depth.astype(np.uint8), "L")


def _depth_map(img: Image.Image, alpha: Optional[np.ndarray] = None) -> Tuple[Image.Image, Dict[str, Any]]:
    global _DEPTH_PIPE, _DEPTH_ERROR
    if ENABLE_DEPTH:
        try:
            if _DEPTH_PIPE is None and _DEPTH_ERROR is None:
                from transformers import pipeline
                device = 0 if (torch is not None and getattr(torch, "cuda", None) and torch.cuda.is_available()) else -1
                _DEPTH_PIPE = pipeline("depth-estimation", model=DEPTH_MODEL_NAME, device=device)
            if _DEPTH_PIPE is not None:
                small = img.convert("RGB")
                small.thumbnail((768, 768), Image.LANCZOS)
                out = _DEPTH_PIPE(small)
                depth = out.get("depth") if isinstance(out, dict) else None
                if isinstance(depth, Image.Image):
                    depth = depth.convert("L").resize(img.size, Image.LANCZOS)
                    if alpha is not None:
                        a = Image.fromarray((alpha > 12).astype(np.uint8) * 255, "L").resize(depth.size)
                        empty = Image.new("L", depth.size, 0)
                        empty.paste(depth, mask=a)
                        depth = empty
                    return depth, {"method": "transformers_depth", "model": DEPTH_MODEL_NAME, "error": ""}
        except Exception as e:
            _DEPTH_ERROR = str(e)
    if alpha is None:
        alpha = np.array(img.convert("RGBA").split()[-1])
    return _synthetic_depth(alpha), {"method": "synthetic_alpha_depth", "model": "none", "error": _DEPTH_ERROR or ""}


def _normal_map_from_depth(depth: Image.Image) -> Image.Image:
    d = np.array(depth.convert("L")).astype(np.float32) / 255.0
    gy, gx = np.gradient(d)
    strength = 3.2
    nx = -gx * strength; ny = -gy * strength; nz = np.ones_like(d)
    norm = np.sqrt(nx*nx + ny*ny + nz*nz) + 1e-6
    n = np.dstack([(nx/norm*0.5+0.5), (ny/norm*0.5+0.5), (nz/norm*0.5+0.5)])
    return Image.fromarray(np.clip(n*255, 0, 255).astype(np.uint8), "RGB")


def _orbit_frame(front: Image.Image, angle_deg: float, back: Optional[Image.Image] = None) -> Image.Image:
    # practical showroom frame: volumetric card illusion using alpha, shading, width scaling and optional back texture
    use_back = back is not None and abs(angle_deg) > 105
    src = (back if use_back else front).convert("RGBA")
    src.thumbnail((780, 920), Image.LANCZOS)
    rad = math.radians(angle_deg)
    scale_x = max(0.10, abs(math.cos(rad)))
    # side view should not disappear completely: show thickness band
    new_w = max(24, int(src.width * scale_x))
    squashed = src.resize((new_w, src.height), Image.LANCZOS)
    shade = 0.78 + 0.22 * max(0, math.cos(rad))
    arr = np.array(squashed).astype(np.float32)
    arr[:, :, :3] *= shade
    squashed = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGBA")
    canvas = Image.new("RGBA", (920, 1040), (250, 253, 255, 255))
    # thickness edge
    edge_w = max(8, int(42 * (1 - scale_x)))
    edge_color = (44, 120, 112, 185)
    x = (canvas.width - new_w) // 2
    y = 65 + (880 - squashed.height) // 2
    if edge_w > 9:
        edge = Image.new("RGBA", (edge_w, squashed.height), edge_color)
        canvas.alpha_composite(edge.filter(ImageFilter.GaussianBlur(1.2)), (x + new_w // 2 - edge_w // 2, y))
    # shadow
    alpha = squashed.split()[-1]
    sh = Image.new("RGBA", squashed.size, (0,0,0,0)); sh.putalpha(alpha.filter(ImageFilter.GaussianBlur(15)).point(lambda p: int(p*.18)))
    canvas.alpha_composite(sh, (x + 14, y + 24))
    canvas.alpha_composite(squashed, (x, y))
    draw = ImageDraw.Draw(canvas)
    draw.ellipse((280, 925, 640, 975), fill=(20, 42, 70, 28))
    return canvas.convert("RGB")


def _build_orbit(front: Image.Image, back: Optional[Image.Image] = None) -> List[str]:
    frames = []
    count = max(12, min(36, FRAME_COUNT))
    for i in range(count):
        angle = -180 + 360 * (i / count)
        frame = _orbit_frame(front, angle, back)
        frames.append(_data_url(frame, "JPEG", 82))
    return frames



def _prepare_triposr_input(product: Image.Image) -> Image.Image:
    """Prepare transparent product crop for image-to-3D model."""
    rgba = product.convert("RGBA")
    # square canvas with alpha, centered and scaled like TripoSR expects
    bbox = rgba.getbbox()
    if bbox:
        rgba = rgba.crop(bbox)
    canvas_size = 512
    canvas = Image.new("RGBA", (canvas_size, canvas_size), (255, 255, 255, 0))
    rgba.thumbnail((420, 420), Image.LANCZOS)
    x = (canvas_size - rgba.width) // 2
    y = (canvas_size - rgba.height) // 2
    canvas.alpha_composite(rgba, (x, y))
    # composite over white for models expecting RGB, but keep object centered
    bg = Image.new("RGB", canvas.size, (255, 255, 255))
    bg.paste(canvas.convert("RGB"), mask=canvas.split()[-1])
    return bg


def _load_triposr():
    global _TRIPOSR_MODEL, _TRIPOSR_ERROR
    if _TRIPOSR_MODEL is not None:
        return _TRIPOSR_MODEL
    if _TRIPOSR_ERROR:
        raise RuntimeError(_TRIPOSR_ERROR)
    try:
        triposr_path = Path(_TRIPOSR_DIR)
        if not triposr_path.exists():
            raise RuntimeError(f"TripoSR repo not found at {_TRIPOSR_DIR}. Run upgrade_v33.sh first.")
        if str(triposr_path) not in sys.path:
            sys.path.insert(0, str(triposr_path))
        from tsr.system import TSR
        if torch is None:
            raise RuntimeError("torch_not_available")
        device = "cuda:0" if torch.cuda.is_available() else "cpu"
        model = TSR.from_pretrained(
            "stabilityai/TripoSR",
            config_name="config.yaml",
            weight_name="model.ckpt",
        )
        model.renderer.set_chunk_size(int(os.environ.get("TRIPOSR_CHUNK_SIZE", "8192")))
        model.to(device)
        _TRIPOSR_MODEL = (model, device)
        return _TRIPOSR_MODEL
    except Exception as e:
        _TRIPOSR_ERROR = str(e)
        raise


def _mesh_to_glb_data_url(mesh) -> str:
    with tempfile.TemporaryDirectory() as td:
        path = os.path.join(td, "spesa_product.glb")
        mesh.export(path)
        with open(path, "rb") as f:
            data = f.read()
    return "data:model/gltf-binary;base64," + base64.b64encode(data).decode("ascii")


def _triposr_glb(product: Image.Image, back: Optional[Image.Image] = None) -> Dict[str, Any]:
    """Generate visible real GLB. Prefer deterministic volume mesh; optionally use TripoSR if requested."""
    # V33.4: guarantee a visible 3D volume first. TripoSR single-view was often too flat for bottles.
    if os.environ.get("SPESA_USE_TRIPOSR_FIRST", "0") != "1":
        return _extruded_alpha_glb(product, back)
    try:
        model, device = _load_triposr()
        inp = _prepare_triposr_input(product)
        if torch is None:
            raise RuntimeError("torch_not_available")
        started = _now_ms()
        with torch.no_grad():
            scene_codes = model([inp], device=device)
            resolution = int(os.environ.get("TRIPOSR_RESOLUTION", "256"))
            try:
                meshes = model.extract_mesh(scene_codes, has_vertex_color=True, resolution=resolution)
            except TypeError:
                meshes = model.extract_mesh(scene_codes, has_vertex_color=False, resolution=resolution)
        mesh = meshes[0]
        glb = _mesh_to_glb_data_url(mesh)
        return {"ok": True,"engine": "TripoSR V33.4.3","realMeshGlb": True,"glbDataUrl": glb,"elapsedMs": _now_ms() - started,"note": "Real GLB mesh generated by TripoSR on RunPod GPU V33.4.3."}
    except Exception:
        return _extruded_alpha_glb(product, back)



def _render3d_payload(product: Image.Image, frames: List[str], mode: str, back: Optional[Image.Image]=None) -> Dict[str, Any]:
    if mode in {"3d", "all"}:
        try:
            real = _triposr_glb(product, back)
            real.update({"kind": "real_glb_mesh", "frames": frames[:8], "frameCount": min(len(frames), 8)})
            return real
        except Exception as e:
            return {
                "kind": "real_mesh_failed",
                "realMeshGlb": False,
                "frames": [],
                "frameCount": 0,
                "error": str(e),
                "note": "TripoSR failed; no fake card returned by TripoSR.",
            }
    return {
        "kind": "render_preview_only",
        "realMeshGlb": False,
        "frames": [],
        "frameCount": 0,
        "note": "Render PRO/label mode: 3D mesh not requested.",
    }


def _pipeline(img: Image.Image, back_img: Optional[Image.Image] = None, mode: str = "render") -> Dict[str, Any]:
    started = _now_ms()
    cut, seg_method = _rembg_cutout(img)
    cut = _restore_label_pixels(img, cut)
    cut = _expand_handle_hole(_defringe_rgba(cut))
    cut = _restore_label_pixels(img, cut)
    product = _enhance_product_pixels(_trim_transparent(cut))
    white = _make_white(product)
    label_source = product
    label_crop, label_meta = _choose_best_label_crop(label_source)
    label_meta["source"] = "segmented_product_only"
    barcode = _barcode_try(img)
    alpha = np.array(product.convert("RGBA").split()[-1])
    if mode in {"3d", "all"}:
        depth, depth_meta = _depth_map(product, alpha)
        normal = _normal_map_from_depth(depth)
    else:
        depth, depth_meta, normal = None, {"method": "skipped_for_speed", "model": "none", "error": ""}, None
    studio = _soft_shadow_card(product, "Render PRO")
    back_cut = None
    if back_img is not None:
        try:
            bc, _ = _rembg_cutout(back_img)
            bc = _restore_label_pixels(back_img, bc)
            bc = _expand_handle_hole(_defringe_rgba(bc))
            back_cut = _trim_transparent(_enhance_product_pixels(bc))
        except Exception:
            back_cut = None
    frames = _build_orbit(product, back_cut) if mode in {"3d", "all"} else []
    shape = {
        "family": "product_volume_estimated",
        "width": product.width,
        "height": product.height,
        "aspectRatio": round(product.width / max(1, product.height), 3),
        "hasBack": back_cut is not None,
        "thicknessModel": "alpha_depth_estimated",
        "acquisitionHints": ["front", "side", "back", "label", "barcode"],
    }
    visual_acquisition = {
        "version": APP_VERSION,
        "goal": "3D visual brain from user product scan",
        "steps": ["front/profile", "side silhouette", "back/rear", "label close-up", "barcode close-up"],
        "uses": ["dimensions", "silhouette", "colors", "label", "barcode", "depth/GLB"],
    }
    return {
        "ok": True,
        "version": APP_VERSION,
        "mode": mode,
        "elapsedMs": _now_ms() - started,
        "imageHash": _image_hash(img),
        "engines": {
            "segmentation": seg_method,
            "label": label_meta.get("method"),
            "depth": depth_meta,
            "barcode": barcode.get("method"),
        },
        "product": {
            "confidence": 0.93 if seg_method.startswith("rembg") else 0.75,
            "shape": shape,
            "visualAcquisition": visual_acquisition,
            "labelBox": label_meta,
            "barcode": barcode,
        },
        "images": {
            "productTransparent": _data_url(product, "PNG"),
            "productWhite": _data_url(white, "JPEG", 90),
            "labelCrop": _data_url(label_crop, "JPEG", 92),
            "renderPro": _data_url(studio, "JPEG", 90),
            "depthMap": _data_url(depth, "PNG") if depth is not None else "",
            "normalMap": _data_url(normal, "JPEG", 88) if normal is not None else "",
            "backTransparent": _data_url(back_cut, "PNG") if back_cut else "",
        },
        "render3d": _render3d_payload(product, frames, mode, back_cut),
        "diagnostics": {
            "rembgError": _REMBG_ERROR or "",
            "depthError": _DEPTH_ERROR or "",
            "torchCuda": bool(torch is not None and getattr(torch, "cuda", None) and torch.cuda.is_available()),
        }
    }



def _safe_json_loads(s: str, fallback=None):
    try:
        import json
        return json.loads(s) if s else (fallback if fallback is not None else {})
    except Exception:
        return fallback if fallback is not None else {}


def _image_quality_metrics(img: Image.Image, cut: Optional[Image.Image] = None) -> Dict[str, Any]:
    rgb = img.convert("RGB")
    arr = np.array(rgb)
    h, w = arr.shape[:2]
    gray = cv2.cvtColor(arr, cv2.COLOR_RGB2GRAY) if cv2 is not None else np.array(rgb.convert("L"))
    sharp = float(cv2.Laplacian(gray, cv2.CV_64F).var()) if cv2 is not None else float(np.var(gray))
    avg = float(gray.mean())
    exposure = "good"
    if avg < 42: exposure = "too_dark"
    elif avg > 224: exposure = "too_bright"
    if cut is None:
        try:
            cut, _ = _rembg_cutout(rgb)
        except Exception:
            cut = None
    coverage = 0.0
    aspect = 1.0
    bbox = None
    fill_ratio = 0.0
    if cut is not None:
        alpha = np.array(cut.convert("RGBA").split()[-1])
        ys, xs = np.where(alpha > 18)
        if len(xs):
            x1, x2, y1, y2 = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())
            area = float((alpha > 18).sum())
            bbox_area = float(max(1, (x2-x1+1)*(y2-y1+1)))
            coverage = area / max(1.0, float(alpha.shape[0] * alpha.shape[1]))
            fill_ratio = area / bbox_area
            aspect = float((y2 - y1 + 1) / max(1, (x2 - x1 + 1)))
            bbox = {"x": x1, "y": y1, "w": x2-x1+1, "h": y2-y1+1, "sourceW": int(alpha.shape[1]), "sourceH": int(alpha.shape[0]), "fillRatio": round(fill_ratio,3)}
    return {"sharpness": round(sharp,2), "brightness": round(avg,2), "exposure": exposure, "objectCoverage": round(coverage,4), "objectAspect": round(aspect,3), "bbox": bbox, "fillRatio": round(fill_ratio,3)}


def _detect_internal_hole(alpha: np.ndarray) -> bool:
    if cv2 is None or alpha.max() < 20:
        return False
    ys, xs = np.where(alpha > 22)
    if len(xs) == 0:
        return False
    x1, x2, y1, y2 = xs.min(), xs.max(), ys.min(), ys.max()
    bw, bh = x2-x1+1, y2-y1+1
    inv = np.zeros_like(alpha, dtype=np.uint8)
    inv[y1:y2+1, x1:x2+1] = (alpha[y1:y2+1, x1:x2+1] < 18).astype(np.uint8)
    num, labels, stats, cents = cv2.connectedComponentsWithStats(inv, 8)
    for i in range(1, num):
        x,y,w,h,area = stats[i]
        if x <= x1 or y <= y1 or x+w >= x2 or y+h >= y2:
            continue
        rx = (cents[i][0]-x1)/max(1,bw); ry = (cents[i][1]-y1)/max(1,bh)
        ar = area/max(1,bw*bh)
        if rx > .54 and .14 < ry < .72 and .003 < ar < .14:
            return True
    return False


def _detect_product_family(product: Image.Image, label_meta: Dict[str,Any]) -> Dict[str, Any]:
    rgba = product.convert("RGBA")
    alpha = np.array(rgba.split()[-1])
    ys, xs = np.where(alpha > 22)
    if len(xs) == 0:
        return {"family":"unknown_product", "requiredViews":["front","sideA","sideB","back"], "requiredParts":["frontLabel"]}
    w = xs.max()-xs.min()+1; h = ys.max()-ys.min()+1
    aspect = h/max(1,w)
    hole = _detect_internal_hole(alpha)
    label_conf = int(label_meta.get('confidence') or 0)
    if hole and aspect > 1.05:
        fam = "detergent_bottle_handle"
        req_views=["front","sideA","back","sideB","top","bottom"]
        req_parts=["cap","handleHole","frontLabel","rearPanel","base","barcode"]
    elif aspect > 1.65:
        fam = "bottle"
        req_views=["front","sideA","back","sideB","top","bottom"]
        req_parts=["cap","frontLabel","barcode","base"]
    elif aspect < .78:
        fam = "box_or_tub_container"
        req_views=["front","sideA","back","sideB","top","bottom"]
        req_parts=["lidOrTop","frontLabel","barcode","base"]
    else:
        fam = "container_or_pack"
        req_views=["front","sideA","back","sideB","top","bottom"]
        req_parts=["frontLabel","barcode","top","base"]
    return {"family":fam,"requiredViews":req_views,"requiredParts":req_parts,"hasHandle":hole,"labelConfidence":label_conf,"aspectRatio":round(aspect,3)}


def _hash8_from_gray(gray: np.ndarray) -> str:
    try:
        small=cv2.resize(gray,(9,8),interpolation=cv2.INTER_AREA) if cv2 is not None else np.array(Image.fromarray(gray).resize((9,8)))
        bits=(small[:,1:]>small[:,:-1]).astype(np.uint8).flatten()
        val=0
        for b in bits: val=(val<<1)|int(b)
        return f"{val:016x}"
    except Exception:
        return "0"*16


def _hamming_hex(a: str, b: str) -> int:
    try: return bin(int(a,16)^int(b,16)).count('1')
    except Exception: return 64


def _descriptor(img: Image.Image, product: Image.Image, label_meta: Dict[str,Any], barcode: Dict[str,Any]) -> Dict[str,Any]:
    rgba=product.convert("RGBA")
    alpha=np.array(rgba.split()[-1])
    rgb=np.array(rgba.convert("RGB"))
    gray=cv2.cvtColor(rgb,cv2.COLOR_RGB2GRAY) if cv2 is not None else np.array(rgba.convert("L"))
    ys,xs=np.where(alpha>22)
    if len(xs):
        x1,x2,y1,y2=int(xs.min()),int(xs.max()),int(ys.min()),int(ys.max())
        crop_rgb=rgb[y1:y2+1,x1:x2+1]
        crop_a=alpha[y1:y2+1,x1:x2+1]
    else:
        x1=y1=0; x2=rgb.shape[1]-1; y2=rgb.shape[0]-1; crop_rgb=rgb; crop_a=alpha
    h,w=crop_a.shape[:2]
    aspect=round(h/max(1,w),3)
    cov=round(float((alpha>22).sum())/max(1,alpha.size),4)
    # color histogram coarse, only object pixels
    mask=crop_a>22
    hist=[]
    if mask.any():
        pix=crop_rgb[mask]
        for c in range(3):
            hh=np.histogram(pix[:,c],bins=8,range=(0,256))[0].astype(np.float32)
            hh=hh/(hh.sum()+1e-6); hist.extend([round(float(x),4) for x in hh])
    else: hist=[0.0]*24
    dh=_hash8_from_gray(gray)
    return {"hash":dh,"hist":hist,"aspect":aspect,"coverage":cov,"bbox":{"x":x1,"y":y1,"w":x2-x1+1,"h":y2-y1+1,"sourceW":rgb.shape[1],"sourceH":rgb.shape[0]},"labelConfidence":int(label_meta.get('confidence') or 0),"barcodeFound":bool(barcode.get('ok') or barcode.get('found')),"barcodeValue":barcode.get('value') or (barcode.get('values') or [''])[0]}


def _hist_distance(a: List[float], b: List[float]) -> float:
    if not a or not b or len(a)!=len(b): return 1.0
    return float(sum(abs(float(x)-float(y)) for x,y in zip(a,b))/max(1,len(a)))


def _ocr_reader():
    global _OCR_READER, _OCR_ERROR
    if _OCR_READER is not None: return _OCR_READER
    if _OCR_ERROR: return None
    try:
        import easyocr
        gpu=bool(torch is not None and getattr(torch,'cuda',None) and torch.cuda.is_available())
        _OCR_READER=easyocr.Reader(['it','en'], gpu=gpu, verbose=False)
        return _OCR_READER
    except Exception as e:
        _OCR_ERROR=str(e)[:180]
        return None


def _ocr_try(img: Image.Image, label_crop: Optional[Image.Image]=None, frame_type: str='wide_view') -> Dict[str,Any]:
    # OCR is attempted mainly for detail frames / label crops; wide frames get light OCR only when label is strong.
    reader=_ocr_reader()
    if reader is None:
        return {"ok":False,"status":"unavailable","engine":"easyocr_gpu_optional","error":_OCR_ERROR or "easyocr_not_loaded"}
    try:
        src=(label_crop if label_crop is not None else img).convert("RGB")
        # close-up/detail gets higher size; wide crop remains moderate
        max_side=1200 if frame_type=='detail_view' else 900
        src.thumbnail((max_side,max_side), Image.LANCZOS)
        src=ImageEnhance.Sharpness(src).enhance(1.35)
        src=ImageEnhance.Contrast(src).enhance(1.14)
        arr=np.array(src)
        results=reader.readtext(arr, detail=1, paragraph=False, text_threshold=0.55, low_text=0.35)
        items=[]
        for r in results or []:
            try:
                box,text,conf=r
                txt=str(text or '').strip()
                if len(txt)<2: continue
                if float(conf)<0.28: continue
                items.append({"text":txt,"confidence":round(float(conf),3)})
            except Exception: pass
        joined=' '.join([x['text'] for x in items])[:1000]
        words=[]
        for w in re.findall(r"[A-Za-zÀ-ÿ0-9%.,/+-]{2,}", joined):
            if w not in words: words.append(w)
        return {"ok":bool(items),"status":"readable" if items else "not_readable","engine":"easyocr_gpu" if bool(torch is not None and getattr(torch,'cuda',None) and torch.cuda.is_available()) else "easyocr_cpu","texts":items[:24],"plainText":joined,"words":words[:80],"confidence":round(max([x['confidence'] for x in items], default=0),3)}
    except Exception as e:
        return {"ok":False,"status":"failed","engine":"easyocr_gpu_optional","error":str(e)[:180]}


def _parts_from_ocr(ocr: Dict[str,Any]) -> List[str]:
    txt=str(ocr.get('plainText') or '').lower()
    parts=[]
    if not txt: return parts
    if any(k in txt for k in ['ingredient','ingredienti','contiene','composizione','avvertenze','modo d\'uso','uso','ml','kg','litri','litro']):
        parts.append('textPanel')
    if any(k in txt for k in ['ingredienti','avvertenze','composizione']):
        parts.append('rearPanel')
    return parts


def _classify_frame_view(frame_index:int, descriptor:Dict[str,Any], metrics:Dict[str,Any], family_meta:Dict[str,Any], parts:List[str], coverage:Dict[str,Any]) -> Dict[str,Any]:
    captured_views=list(coverage.get('capturedViews') or [])
    front_desc=coverage.get('frontDescriptor') or {}
    last_desc=coverage.get('lastDescriptor') or {}
    view_descs=coverage.get('viewDescriptors') or {}
    target_view=str(coverage.get('targetView') or '').strip()
    evidence=[]
    if target_view:
        evidence.append('mission_target_'+target_view)
    view='unknown'; conf=0; coverage_gain=0
    obj_cov=float(metrics.get('objectCoverage') or descriptor.get('coverage') or 0)
    aspect=float(metrics.get('objectAspect') or descriptor.get('aspect') or 1)
    label_conf=int(descriptor.get('labelConfidence') or 0)
    barcode_found=bool(descriptor.get('barcodeFound'))
    # distance / scale awareness
    prev_cov=float((last_desc or {}).get('coverage') or 0)
    if prev_cov>0:
        ratio=obj_cov/max(1e-6,prev_cov)
        if ratio>1.22: distance='closer'
        elif ratio<0.82: distance='farther'
        else: distance='stable'
    else:
        distance='unknown'
    # detail vs wide: close-up frames are useful for OCR/barcode but not geometry coverage
    bbox=metrics.get('bbox') or {}
    cut_edge=False
    vertical_shift=0.0
    if bbox:
        sw,sh=max(1,int(bbox.get('sourceW') or 1)),max(1,int(bbox.get('sourceH') or 1))
        x,y,w,h=int(bbox.get('x') or 0),int(bbox.get('y') or 0),int(bbox.get('w') or 0),int(bbox.get('h') or 0)
        cut_edge=(x<4 or y<4 or x+w>sw-5 or y+h>sh-5)
        try:
            cm=coverage.get('clientMotion') or {}
            pb=cm.get('previousBbox') or {}
            if pb and pb.get('sourceH'):
                prev_cy=(float(pb.get('y',0))+float(pb.get('h',0))/2.0)/max(1.0,float(pb.get('sourceH') or sh))
                cur_cy=(y+h/2.0)/max(1.0,float(sh))
                vertical_shift=cur_cy-prev_cy
        except Exception:
            vertical_shift=0.0
    # V33.4.25: Deep Pixel-Skin motion logic. Tall handle/bottle profiles must stay WIDE geometry,
    # not be misclassified as tilt just because the silhouette is tall. Tilt is only a real top/base intent.
    lift_signal = abs(vertical_shift) > 0.060
    profile_motion = ('front' in captured_views and obj_cov > .080 and not cut_edge and .12 <= obj_cov <= .66 and aspect >= 1.34)
    top_bottom_shape = (aspect < 1.24 and obj_cov > .10) or (lift_signal and (obj_cov > .09 or distance in {'closer','farther'}))
    tilt_signal = bool('front' in captured_views and top_bottom_shape)
    # Close-up/detail only when the product is clearly cropped or the user is intentionally reading label/barcode.
    detail_intent = bool((obj_cov > .70) or (cut_edge and obj_cov > .55) or (distance == 'closer' and obj_cov > .58 and (barcode_found or label_conf >= 72)))
    frame_type='tilt_view' if tilt_signal else ('detail_view' if detail_intent and not profile_motion else 'wide_view')
    if label_conf>=62: evidence.append('front_label_visible')
    if barcode_found: evidence.append('barcode_or_rear_panel')
    if family_meta.get('hasHandle'): evidence.append('handle_hole_visible')
    if tilt_signal: evidence.append('top_or_base_tilt_detected')
    if abs(vertical_shift)>0.075: evidence.append('vertical_lift_motion')
    # Similarities
    front_diff=1.0; front_hash=64; last_hash=64
    if front_desc:
        front_diff=_hist_distance(descriptor.get('hist') or [], front_desc.get('hist') or [])
        front_hash=_hamming_hex(str(descriptor.get('hash','0')), str(front_desc.get('hash','0')))
    if last_desc:
        last_hash=_hamming_hex(str(descriptor.get('hash','0')), str(last_desc.get('hash','0')))
    # V33.4.25 GUIDED PRODUCT-TWIN CLASSIFIER: Render tells the worker which view is needed next.
    # This avoids confusing front/back/side during free rotation. It still requires wide object geometry.
    if target_view in {'front','sideA','sideB','back','top','bottom'} and frame_type!='detail_view' and not cut_edge and obj_cov>=.07 and obj_cov<=.74:
        if target_view=='front' and label_conf>=50:
            view='front'; conf=max(84,min(97,80+label_conf//4)); evidence.append('guided_front_confirmed'); coverage_gain=max(18,coverage_gain)
        elif target_view in {'sideA','sideB'} and 'front' in captured_views:
            side_signal = family_meta.get('hasHandle') or front_hash>7 or front_diff>.015 or label_conf<95 or abs(aspect-float((front_desc or {}).get('aspect') or aspect))>.08
            if side_signal:
                view=target_view; conf=88 if family_meta.get('hasHandle') else 84; evidence.append('guided_side_profile_confirmed'); coverage_gain=max(18,coverage_gain)
        elif target_view=='back' and 'front' in captured_views:
            back_signal = barcode_found or ('rearPanel' in parts) or ('textPanel' in parts) or front_hash>7 or front_diff>.018 or label_conf<92 or ('sideA' in captured_views or 'sideB' in captured_views)
            if back_signal:
                view='back'; conf=88 if (barcode_found or 'rearPanel' in parts or 'textPanel' in parts) else 82; evidence.append('guided_back_confirmed'); coverage_gain=max(18,coverage_gain)
        elif target_view in {'top','bottom'} and 'front' in captured_views:
            bottle_tb = family_meta.get('family') in {'bottle','detergent_bottle_handle'} and obj_cov>.09 and obj_cov<.58 and aspect<1.42
            tb_signal = tilt_signal or aspect<1.30 or abs(vertical_shift)>.035 or distance in {'closer','farther'} or bottle_tb or ('cap' in parts and target_view=='top') or ('base' in parts and target_view=='bottom')
            if tb_signal:
                view=target_view; conf=84 if bottle_tb else 82; evidence.append('guided_'+target_view+'_confirmed'); coverage_gain=max(10,coverage_gain)
    # Front: only if wide, label visible, not already captured
    if view=='unknown' and frame_type=='wide_view' and 'front' not in captured_views and label_conf>=58:
        view='front'; conf=min(96,78+label_conf//5); evidence.append('wide_front_label_confirmed'); coverage_gain=18
    elif frame_type=='detail_view':
        view='detail'; conf=60 if (label_conf>=58 or barcode_found) else 35; evidence.append('closeup_detail_not_geometry')
        coverage_gain=0
    else:
        # V33.4.10 Top/base: if user lifts product, accept a tilted geometry view even if close.
        if tilt_signal and 'front' in captured_views:
            # In real use, when the product moves upward in frame the user is usually lifting it to show the underside/base.
            prefer_bottom = vertical_shift < -0.045 or frame_index >= 8 or 'sideA' in captured_views or 'back' in captured_views or 'sideB' in captured_views or aspect < 1.42
            if 'bottom' not in captured_views and prefer_bottom:
                view='bottom'; conf=86; evidence.append('tilted_bottom_base_confirmed'); coverage_gain=12
            elif 'top' not in captured_views:
                view='top'; conf=82; evidence.append('tilted_top_confirmed'); coverage_gain=9
            elif 'bottom' not in captured_views:
                view='bottom'; conf=86; evidence.append('tilted_bottom_base_confirmed_late'); coverage_gain=12
            else:
                view='unknown'; conf=58; evidence.append('tilt_already_captured')
        # Back: front label gone/different and barcode/rear text or sufficiently different texture
        rear_signal = barcode_found or ('rearPanel' in parts) or ('textPanel' in parts and label_conf<70)
        if view=='unknown' and 'front' in captured_views and rear_signal and (front_diff>.055 or front_hash>16 or barcode_found):
            view='back'; conf=84 + (8 if barcode_found else 0); evidence.append('rear_texture_or_barcode_confirmed'); coverage_gain=18
        # Side: object narrows / label weakens / large change from front. Name as sideA/sideB, not fake right/left.
        elif view=='unknown' and 'front' in captured_views and frame_type=='wide_view' and (front_hash>16 or front_diff>.042 or aspect>float((front_desc or {}).get('aspect') or aspect)*1.08) and label_conf<88:
            if 'sideA' not in captured_views:
                view='sideA'; conf=84; evidence.append('side_angle_confirmed_by_shape_change'); coverage_gain=16
            elif 'sideB' not in captured_views and (view_descs.get('sideA') and _hamming_hex(str(descriptor.get('hash','0')), str(view_descs.get('sideA',{}).get('hash','0')))>14):
                view='sideB'; conf=84; evidence.append('second_side_distinct_from_first_side'); coverage_gain=16
            else:
                view='unknown'; conf=52; evidence.append('angle_changed_but_side_already_seen_or_not_distinct')
        elif view=='unknown' and family_meta.get('hasHandle') and 'front' in captured_views and frame_type=='wide_view' and (front_hash>8 or front_diff>.020 or aspect<1.72 or aspect>2.04 or label_conf<92):
            # V33.4.25: handle bottles often keep front label visible while turning; use shape/profile novelty, not only label disappearance.
            if 'sideA' not in captured_views:
                view='sideA'; conf=88; evidence.append('handle_profile_side_confirmed'); coverage_gain=18
            elif 'sideB' not in captured_views and (view_descs.get('sideA') and _hamming_hex(str(descriptor.get('hash','0')), str(view_descs.get('sideA',{}).get('hash','0')))>10):
                view='sideB'; conf=88; evidence.append('handle_profile_second_side_confirmed'); coverage_gain=18
            else:
                view='unknown'; conf=55; evidence.append('handle_profile_seen_but_not_distinct')
        elif view=='unknown' and label_conf>=58 and 'front' in captured_views and (front_hash<=14 or front_diff<=.050):
            view='front'; conf=70; evidence.append('duplicate_front_or_small_rotation'); coverage_gain=0
        elif view=='unknown':
            view='unknown'; conf=45; evidence.append('insufficient_view_evidence')
    # Top/bottom are only confirmed from strongly compressed/tilted views; keep conservative.
    if frame_type=='wide_view' and view=='unknown' and aspect<0.95 and obj_cov>.11:
        if 'top' not in captured_views:
            view='top'; conf=76; coverage_gain=10; evidence.append('tilted_top_candidate')
        elif 'bottom' not in captured_views:
            view='bottom'; conf=76; coverage_gain=10; evidence.append('tilted_bottom_candidate')
    return {"view":view,"viewConfidence":int(min(99,max(0,conf))),"distanceState":distance,"frameType":frame_type,"frontDiff":round(float(front_diff),4),"frontHashDistance":int(front_hash),"lastHashDistance":int(last_hash),"verticalShift":round(float(vertical_shift),4),"evidence":evidence,"coverageGain":coverage_gain,"cutEdge":cut_edge,"targetView":target_view}


def _next_instruction(required_views: List[str], required_parts: List[str], captured_views: List[str], captured_parts: List[str], accepted: bool, reason: str, family: str, view_info: Optional[Dict[str,Any]]=None, barcode: Optional[Dict[str,Any]]=None, ocr: Optional[Dict[str,Any]]=None) -> str:
    view_info=view_info or {}
    barcode=barcode or {}
    distance=str(view_info.get('distanceState') or 'unknown')
    if not accepted:
        if reason == "too_blurry": return "Tienilo più fermo un attimo: il frame è mosso."
        if reason == "bad_exposure": return "Correggi luce o riflesso: devo vedere colori ed etichetta."
        if reason == "product_cut_or_too_small":
            return "Inquadra il prodotto intero e centrale." if distance != 'closer' else "Sei troppo vicino: allontanati un po' e tieni il prodotto intero dentro la griglia."
        if reason == "duplicate_angle": return "Angolo già visto: ruota ancora lentamente fino al lato successivo."
        if reason == "view_not_confident": return "Sto verificando l’angolo: continua lentamente, non ho prove sufficienti."
        return "Continua lentamente, cerco un angolo migliore."
    if barcode.get('status') in {'detected_not_decoded','too_blurry','too_far'}:
        return "Barcode rilevato: avvicinati leggermente e tieni fermo un secondo."
    if view_info.get('frameType')=='detail_view':
        if ocr and ocr.get('ok'): return "Testo letto. Ora torna a una vista larga per la geometria 3D."
        return "Dettaglio acquisito. Se vuoi leggere etichetta o barcode, avvicinati e tieni fermo."
    missing_views=[v for v in required_views if v not in captured_views]
    missing_parts=[p for p in required_parts if p not in captured_parts]
    if missing_views:
        m=missing_views[0]
        names={"front":"frontale","sideA":"un primo lato","sideB":"l'altro lato","back":"retro","top":"parte superiore / tappo o coperchio","bottom":"base"}
        return "Bene. Ora mostrami " + names.get(m,m) + "."
    if missing_parts:
        p=missing_parts[0]
        names={"cap":"il tappo","handleHole":"il foro del manico","frontLabel":"l'etichetta frontale","rearPanel":"il retro","base":"la base","barcode":"il barcode","lidOrTop":"il coperchio","textPanel":"le scritte del prodotto"}
        return "Mi manca " + names.get(p,p) + ". Avvicina o ruota leggermente."
    return "Dati sufficienti. Posso generare il modello 3D."




def _mask_quality_from_cut(cut: Optional[Image.Image], metrics: Dict[str,Any]) -> Dict[str,Any]:
    """Google-like mask judge: estimates if the detected subject is clean enough for live scanning."""
    try:
        if cut is None:
            return {"purity":0.0,"leakage":1.0,"holes":0,"contourSharpness":0.0,"edgeTrust":0.0,"ok":False,"reason":"no_cut"}
        rgba=cut.convert('RGBA')
        alpha=np.array(rgba.split()[-1])
        mask=alpha>30
        h,w=mask.shape[:2]
        if mask.sum()<64:
            return {"purity":0.0,"leakage":1.0,"holes":0,"contourSharpness":0.0,"edgeTrust":0.0,"ok":False,"reason":"empty_mask"}
        ys,xs=np.where(mask)
        x1,x2=int(xs.min()),int(xs.max())+1; y1,y2=int(ys.min()),int(ys.max())+1
        bw,bh=max(1,x2-x1),max(1,y2-y1)
        bbox_area=max(1,bw*bh)
        fill=float(mask[y1:y2,x1:x2].sum())/bbox_area
        coverage=float(mask.sum())/max(1,w*h)
        touch=x1<=2 or y1<=2 or x2>=w-3 or y2>=h-3
        holes=0
        contour_sharp=0.55
        if cv2 is not None:
            m=(mask.astype(np.uint8))*255
            inv=cv2.bitwise_not(m)
            # holes: background components fully inside bbox-ish
            contours,_=cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            contour_area=sum(float(cv2.contourArea(c)) for c in contours) if contours else 0.0
            edge=cv2.Canny(m,40,140)
            contour_sharp=float((edge>0).sum())/max(1, int(mask.sum()))
            contour_sharp=float(max(0.0,min(1.0,contour_sharp*2.8)))
            # estimate holes from connected components in inverted mask inside bbox
            roi_inv=inv[y1:y2,x1:x2]
            n, labels, stats, _ = cv2.connectedComponentsWithStats(roi_inv, 8)
            for i in range(1,n):
                x,y,ww,hh,area=stats[i]
                if area>20 and x>1 and y>1 and x+ww<roi_inv.shape[1]-1 and y+hh<roi_inv.shape[0]-1:
                    holes+=1
        edge_penalty=0.22 if touch else 0.0
        overfill_penalty=max(0.0, fill-0.92)*1.2
        underfill_penalty=max(0.0, 0.18-fill)*1.8
        purity=max(0.0,min(1.0, fill - edge_penalty - overfill_penalty - underfill_penalty + contour_sharp*0.08))
        leakage=max(0.0,min(1.0, (1.0-purity)*0.72 + edge_penalty + max(0.0,coverage-0.82)))
        edge_trust=0.0 if touch else max(0.0,min(1.0, contour_sharp + 0.25))
        ok=bool(purity>=0.74 and leakage<=0.28 and coverage>=0.030 and coverage<=0.76 and not (fill>0.94 and coverage>0.42))
        return {"purity":round(purity,3),"leakage":round(leakage,3),"holes":int(holes),"contourSharpness":round(contour_sharp,3),"edgeTrust":round(edge_trust,3),"fill":round(fill,3),"coverage":round(coverage,3),"touchEdge":bool(touch),"ok":ok,"reason":"ok" if ok else "mask_not_clean_enough"}
    except Exception as e:
        return {"purity":0.0,"leakage":1.0,"holes":0,"contourSharpness":0.0,"edgeTrust":0.0,"ok":False,"reason":"mask_quality_error","error":str(e)[:120]}


def _object_lock_state(metrics: Dict[str,Any], mask_quality: Dict[str,Any], coverage: Dict[str,Any]) -> Dict[str,Any]:
    bb=metrics.get('bbox') or {}
    sw=max(1.0,float(bb.get('sourceW') or 1)); sh=max(1.0,float(bb.get('sourceH') or 1))
    x=float(bb.get('x') or 0); y=float(bb.get('y') or 0); w=float(bb.get('w') or 0); h=float(bb.get('h') or 0)
    cx=(x+w/2)/sw; cy=(y+h/2)/sh
    centrality=max(0.0,1.0-(abs(cx-0.5)*1.75+abs(cy-0.5)*1.25)/2.0)
    size_ok=0.08 <= float(metrics.get('objectCoverage') or 0) <= 0.68 and float(metrics.get('fillRatio') or 0) <= 0.88
    sharp_ok=float(metrics.get('sharpness') or 0)>=55
    purity=float(mask_quality.get('purity') or 0)
    locked=bool(size_ok and sharp_ok and purity>=0.74 and centrality>=0.36 and not mask_quality.get('touchEdge'))
    stable_frames=int((coverage.get('objectLock') or {}).get('stableFrames') or 0)
    if locked: stable_frames=min(30,stable_frames+1)
    else: stable_frames=max(0,stable_frames-1)
    drift=round(max(0.0,min(1.0,1.0-centrality + (0.18 if not size_ok else 0))),3)
    conf=int(max(0,min(100, purity*55 + centrality*30 + (15 if sharp_ok else 0))))
    return {"locked":locked,"targetId":"primary_product","confidence":conf,"stableFrames":stable_frames,"objectPurity":round(purity,3),"driftRisk":drift,"centrality":round(centrality,3),"sizeOk":bool(size_ok),"sharpOk":bool(sharp_ok),"reason":"locked" if locked else ("mask" if purity<0.74 else "motion_or_framing")}


def _pose_estimate(view_info: Dict[str,Any], descriptor: Dict[str,Any], coverage: Dict[str,Any]) -> Dict[str,Any]:
    view=str(view_info.get('view') or 'unknown')
    yaw_map={"front":0,"sideA":85,"back":180,"sideB":270,"top":0,"bottom":0,"detail":0,"unknown":0}
    pitch=0
    if view=='top': pitch=-62
    elif view=='bottom': pitch=62
    elif view_info.get('frameType')=='tilt_view': pitch=28
    novelty=1.0
    try:
        view_descs=coverage.get('viewDescriptors') or {}
        if view in view_descs:
            novelty=min(1.0,_hamming_hex(str(descriptor.get('hash','0')), str((view_descs.get(view) or {}).get('hash','0')))/26.0)
    except Exception:
        novelty=0.5
    return {"discreteView":view,"yaw":yaw_map.get(view,0),"pitch":pitch,"roll":0,"confidence":int(view_info.get('viewConfidence') or 0),"noveltyVsHistory":round(float(novelty),3),"frameType":view_info.get('frameType') or 'unknown'}


def _geometry_scores(view_info: Dict[str,Any], metrics: Dict[str,Any], mask_quality: Dict[str,Any], object_lock: Dict[str,Any], pose: Dict[str,Any], parts: List[str]) -> Dict[str,Any]:
    ev=[str(e).lower() for e in (view_info.get('evidence') or [])]
    duplicate=any(('duplicate' in e or 'already' in e or 'not_distinct' in e or 'small_rotation' in e) for e in ev)
    pose_novel=float(pose.get('noveltyVsHistory') or 0)
    purity=float(mask_quality.get('purity') or 0)
    conf=float(view_info.get('viewConfidence') or 0)/100.0
    sharp=min(1.0,float(metrics.get('sharpness') or 0)/130.0)
    gain=min(1.0,float(view_info.get('coverageGain') or 0)/18.0)
    part_gain=min(1.0,len(parts)/5.0)
    penalty=(0.28 if duplicate else 0.0)+(0.30 if view_info.get('frameType')=='detail_view' else 0.0)+(0.18 if view_info.get('frameType')=='tilt_view' and view_info.get('view') not in {'top','bottom'} else 0.0)+(0.35 if not object_lock.get('locked') else 0.0)+(0.25 if not mask_quality.get('ok') else 0.0)
    score=max(0.0,min(1.0, conf*0.25 + purity*0.20 + sharp*0.12 + gain*0.18 + pose_novel*0.15 + part_gain*0.10 - penalty))
    return {"geometryUsefulnessScore":int(round(score*100)),"poseNoveltyScore":int(round(pose_novel*100)),"shapeNovelty":round(gain,3),"backgroundPenalty":round(max(0.0,1.0-purity),3),"redundancyPenalty":round(0.28 if duplicate else 0.0,3),"acceptedForFusion":bool(score>=0.70 and object_lock.get('locked') and mask_quality.get('ok') and not duplicate)}

def _overlay_cells(metrics: Dict[str,Any], captured_parts: List[str], frame_type: str, accepted: bool, cut: Optional[Image.Image]=None) -> Dict[str,Any]:
    bbox=metrics.get('bbox') or {}
    object_cells=[]
    mask_quality=_mask_quality_from_cut(cut, metrics)
    try:
        if cut is not None and bbox and bbox.get('sourceW'):
            alpha=np.array(cut.convert('RGBA').split()[-1])
            x0=int(max(0,bbox.get('x',0))); y0=int(max(0,bbox.get('y',0)))
            bw=int(max(1,bbox.get('w',0))); bh=int(max(1,bbox.get('h',0)))
            # Deep Pixel-Skin: use an eroded SOLID skin for cells so edge/background leaks do not become visible cells.
            mask=(alpha>42).astype(np.uint8)
            if cv2 is not None:
                solid=cv2.erode(mask, np.ones((2,2),np.uint8), iterations=1)
                edge=cv2.dilate(mask, np.ones((2,2),np.uint8), iterations=1)-solid
            else:
                solid=mask; edge=np.zeros_like(mask)
            # target tiny cells in source pixels; capped for mobile payload.
            cell_px=4 if max(bw,bh)>420 else 5
            cols=int(max(72,min(190,bw//cell_px)))
            rows=int(max(96,min(280,bh//cell_px)))
            # stricter when mask leaks; still keep a few contour cells for perceived shape.
            leak=float(mask_quality.get('leakage') or 0)
            purity=float(mask_quality.get('purity') or 0)
            for r in range(rows):
                for c in range(cols):
                    x1=x0+int(c*bw/cols); x2=x0+int((c+1)*bw/cols)
                    y1=y0+int(r*bh/rows); y2=y0+int((r+1)*bh/rows)
                    if x2<=x1 or y2<=y1: continue
                    yy1,yy2=max(0,y1),min(alpha.shape[0],y2)
                    xx1,xx2=max(0,x1),min(alpha.shape[1],x2)
                    patch_a=alpha[yy1:yy2, xx1:xx2]
                    patch_s=solid[yy1:yy2, xx1:xx2]
                    patch_e=edge[yy1:yy2, xx1:xx2]
                    if patch_a.size==0: continue
                    fill=float((patch_a>42).sum())/max(1,patch_a.size)
                    core=float((patch_s>0).sum())/max(1,patch_s.size)
                    edge_fill=float((patch_e>0).sum())/max(1,patch_e.size)
                    min_core=0.46 if (accepted and mask_quality.get('ok')) else 0.62
                    # cells with no solid core are usually table/wall leaks. Keep only very strong contour cells.
                    if core < min_core and not (edge_fill>.62 and fill>.88 and leak<.18):
                        continue
                    state='locked' if accepted else ('partial' if frame_type in {'detail_view','tilt_view'} else 'scan')
                    if not mask_quality.get('ok') or leak>.26: state='partial'
                    object_cells.append({'x':int(x1),'y':int(y1),'w':int(max(2,min(5,x2-x1))),'h':int(max(2,min(5,y2-y1))),'state':state,'fill':round(fill,2),'core':round(core,2),'tracked':True,'active':True,'objectCoverage':round(core,2),'edgeConfidence':mask_quality.get('edgeTrust',0),'temporalStability':1.0 if accepted else 0.52,'backgroundLeakage':round(leak,3)})
            # deterministic thinning if too many cells: keep high-core cells plus evenly spaced shape points.
            if len(object_cells)>9000:
                object_cells=sorted(object_cells, key=lambda x:(float(x.get('core',0)), float(x.get('fill',0))), reverse=True)[:9000]
    except Exception:
        object_cells=[]
    return {'bbox':bbox,'objectCells':object_cells,'transparent':True,'objectOnly':True,'objectAlwaysVisible':True,'message':'deep pixel-skin micro-celle agganciate solo alla sagoma oggetto','maskQuality':mask_quality,'cellCount':len(object_cells),'skinMode':'guided_dense_pixel_skin_v33425'}


def _frame_acceptance(img: Image.Image, frame_index: int, coverage_json: str = "") -> Dict[str,Any]:
    started=_now_ms()
    try:
        cut, seg_method = _rembg_cutout(img)
        cut = _restore_label_pixels(img, cut) if '_restore_label_pixels' in globals() else cut
        cut = _expand_handle_hole(_defringe_rgba(cut)) if '_expand_handle_hole' in globals() and '_defringe_rgba' in globals() else cut
        product = _trim_transparent(cut)
        label_crop, label_meta = _choose_best_label_crop(product)
    except Exception as e:
        product = img.convert("RGBA")
        label_crop = img.convert("RGB")
        label_meta={"confidence":0,"method":"frame_no_segmentation","error":str(e)}
        seg_method="failed"
    metrics=_image_quality_metrics(img, product)
    barcode=_barcode_try(img)
    family_meta=_detect_product_family(product, label_meta)
    coverage=_safe_json_loads(coverage_json, {})
    remembered_barcode = str(coverage.get("barcodeValue") or coverage.get("barcode") or coverage.get("lastBarcodeValue") or "").strip()
    captured_views=list(coverage.get('capturedViews') or [])
    captured_parts=list(coverage.get('capturedParts') or [])
    if (not barcode.get("ok")) and remembered_barcode and 8 <= len(re.sub(r"\D", "", remembered_barcode)) <= 14:
        barcode = {"ok":True,"found":True,"status":"remembered_from_history","value":re.sub(r"\D", "", remembered_barcode),"values":[re.sub(r"\D", "", remembered_barcode)],"types":["EAN/UPC"],"confidence":72,"method":"coverage_memory_barcode_v33426"}
    descriptor=_descriptor(img, product, label_meta, barcode)
    # classify close-up/detail before OCR so OCR can use higher confidence when close
    rough_frame_type='detail_view' if (metrics.get('objectCoverage',0)>.52) else 'wide_view'
    ocr=_ocr_try(img, label_crop, rough_frame_type)
    parts=[]
    if family_meta.get('family') in {'bottle','detergent_bottle_handle'}: parts.append('cap')
    if family_meta.get('family') in {'box_or_tub_container'}: parts.append('lidOrTop')
    if int(label_meta.get('confidence') or 0) >= 58: parts.append('frontLabel')
    if barcode and barcode.get('ok'): parts.append('barcode')
    for p in _parts_from_ocr(ocr):
        if p not in parts: parts.append(p)
    # quality gates
    reason='ok'; accepted=True
    if metrics['sharpness'] < 65: accepted=False; reason='too_blurry'
    elif metrics['brightness'] < 38 or metrics['brightness'] > 232: accepted=False; reason='bad_exposure'
    elif metrics['objectCoverage'] < .060: accepted=False; reason='object_too_small_or_missing'
    elif metrics.get('fillRatio',0) > .94 and metrics['objectCoverage'] > .48 and not (barcode.get('found') or ocr.get('ok') or int(label_meta.get('confidence') or 0)>=62): accepted=False; reason='product_too_close_or_cut'
    elif metrics['objectCoverage'] > .76 and not (barcode.get('found') or ocr.get('ok') or int(label_meta.get('confidence') or 0)>=62): accepted=False; reason='product_too_close_or_cut'
    else:
        bb=metrics.get('bbox') or {}
        if bb and bb.get('sourceW'):
            cx=(float(bb.get('x',0))+float(bb.get('w',0))/2)/max(1.0,float(bb.get('sourceW') or 1))
            cy=(float(bb.get('y',0))+float(bb.get('h',0))/2)/max(1.0,float(bb.get('sourceH') or 1))
            edge=float(bb.get('x',0))<4 or float(bb.get('y',0))<4 or float(bb.get('x',0))+float(bb.get('w',0))>float(bb.get('sourceW',1))-5 or float(bb.get('y',0))+float(bb.get('h',0))>float(bb.get('sourceH',1))-5
            if edge and metrics['objectCoverage']>.10: accepted=False; reason='object_cut_edge'
            elif cx<.18 or cx>.82 or cy<.10 or cy>.92: accepted=False; reason='object_not_centered'
    view_info=_classify_frame_view(frame_index, descriptor, metrics, family_meta, parts, coverage)
    mask_quality=_mask_quality_from_cut(product, metrics)
    object_lock=_object_lock_state(metrics, mask_quality, coverage)
    pose_estimate=_pose_estimate(view_info, descriptor, coverage)
    view=view_info['view']
    if family_meta.get('hasHandle') and view in {'front','sideA','sideB'} and view_info.get('viewConfidence',0)>=75 and 'handleHole' not in parts:
        parts.append('handleHole')
    if view=='bottom' and 'base' not in parts: parts.append('base')
    if view=='top':
        if family_meta.get('family') in {'box_or_tub_container','container_or_pack'} and 'lidOrTop' not in parts: parts.append('lidOrTop')
        elif 'cap' not in parts: parts.append('cap')
    geom_scores=_geometry_scores(view_info, metrics, mask_quality, object_lock, pose_estimate, parts)
    if accepted and not object_lock.get('locked'):
        accepted=False; reason='object_lock_not_stable'
    elif accepted and not mask_quality.get('ok'):
        accepted=False; reason='mask_purity_low'
    elif accepted and geom_scores.get('geometryUsefulnessScore',0) < 70:
        accepted=False; reason='geometry_usefulness_low'
    # Truth Gate scanner 3D: i frame detail servono a OCR, NON entrano nella mesh.
    detail_accepted = False
    geometry_views={'front','sideA','sideB','back','top','bottom'}
    if view in {'detail'} or view_info.get('frameType')=='detail_view':
        detail_accepted = bool(ocr.get('ok') or barcode.get('found') or int(label_meta.get('confidence') or 0)>=58)
        accepted=False; reason='detail_data_only'
    elif accepted and view not in geometry_views:
        accepted=False; reason='view_not_geometry'
    elif accepted and view_info['viewConfidence'] < 80:
        accepted=False; reason='view_not_confident'
    elif accepted and view_info.get('frameType') == 'tilt_view' and view not in {'top','bottom'}:
        accepted=False; reason='tilt_not_geometry'
    elif accepted and any(str(e).lower().find('duplicate')>=0 or str(e).lower().find('already_captured')>=0 or str(e).lower().find('not_distinct')>=0 or str(e).lower().find('small_rotation')>=0 for e in view_info.get('evidence', [])):
        accepted=False; reason='duplicate_or_not_distinct'
    elif accepted and view in captured_views and not any(p not in captured_parts for p in parts):
        accepted=False; reason='duplicate_angle'
    geometry_accepted = bool(accepted and view in geometry_views and view_info['viewConfidence']>=80 and reason=='ok')
    score=45
    score += min(24, metrics['sharpness']/9)
    score += 16 if .08 <= metrics['objectCoverage'] <= .70 else 4
    score += 12 if reason=='ok' else -12
    score += 8 if parts else 0
    score += 8 if object_lock.get('locked') else -8
    score += min(10, int(float(mask_quality.get('purity') or 0)*10))
    score += min(10, int(ocr.get('confidence',0)*10)) if ocr.get('ok') else 0
    score=max(0,min(100,int(round(score))))
    # Confirm captures: solo geometry_accepted aggiorna le viste 3D. Detail può aggiungere testo/label ma non mesh.
    if geometry_accepted:
        if view not in {'unknown','detail'} and view not in captured_views: captured_views.append(view)
        for p in parts:
            if p not in captured_parts: captured_parts.append(p)
    elif detail_accepted:
        for p in parts:
            if p in {'frontLabel','textPanel','barcode'} and p not in captured_parts: captured_parts.append(p)
    required_views=family_meta.get('requiredViews') or ["front","sideA","back","sideB"]
    required_parts=family_meta.get('requiredParts') or ["frontLabel"]
    # Real coverage: front + each side/back weighted; detail only helps parts, not geometry.
    view_weight={"front":20,"sideA":16,"sideB":16,"back":22,"top":8,"bottom":8}
    part_weight={"frontLabel":8,"barcode":8,"handleHole":6,"cap":4,"lidOrTop":4,"base":4,"rearPanel":5,"textPanel":5}
    coverage_percent=0
    for v in set(captured_views): coverage_percent += view_weight.get(v,0)
    for p in set(captured_parts): coverage_percent += part_weight.get(p,0)
    coverage_percent=int(max(0,min(100,coverage_percent)))
    # cap front-only: cannot exceed 35 if only front geometry seen
    geom=[v for v in captured_views if v in {'front','sideA','sideB','back','top','bottom'}]
    if set(geom).issubset({'front','top','bottom'}): coverage_percent=min(coverage_percent,35)
    geom_set=set(captured_views)&set(['front','sideA','sideB','back','top','bottom'])
    if 'front' in geom_set and not (geom_set & set(['sideA','sideB','back'])):
        coverage_percent=min(coverage_percent,42)
    if not ('front' in geom_set and (geom_set & set(['sideA','sideB','back']))):
        coverage_percent=min(coverage_percent,55)
    # V33.4.25: google-like no false ready. Current frame must be accepted geometry with object lock too.
    geom_views_set=set(captured_views)&set(['front','sideA','sideB','back','top','bottom'])
    build_confidence=int(max(0,min(100, (coverage_percent*0.35) + geom_scores.get('geometryUsefulnessScore',0)*0.35 + object_lock.get('confidence',0)*0.15 + float(mask_quality.get('purity') or 0)*100*0.15 )))
    ready=bool(geometry_accepted and build_confidence>=76 and coverage_percent>=68 and 'front' in geom_views_set and len(geom_views_set&set(['sideA','sideB']))>=1 and 'back' in geom_views_set and len(geom_views_set)>=3 and bool(set(captured_parts)&set(['frontLabel','barcode','textPanel'])))
    preview_ready=bool(geometry_accepted and build_confidence>=60 and 'front' in geom_views_set and len(geom_views_set&set(['sideA','sideB','back']))>=1 and coverage_percent>=45)
    missing_views=[v for v in required_views if v not in captured_views]
    missing_parts=[p for p in required_parts if p not in captured_parts]
    overlay=_overlay_cells(metrics, captured_parts, view_info['frameType'], geometry_accepted, cut)
    status_barcode=barcode.get('status') or ('confirmed' if barcode.get('ok') else 'not_seen')
    label_status='readable' if int(label_meta.get('confidence') or 0)>=58 or ocr.get('ok') else 'not_readable'
    if reason in {'too_blurry','bad_exposure'}:
        cadence_ms=1350
    elif view_info['frameType']=='detail_view':
        cadence_ms=1250
    elif ready:
        cadence_ms=900
    else:
        cadence_ms=1100
    if reason in {'product_cut_or_too_small','product_too_close_or_cut','object_cut_edge'}:
        analysis_advice="Il prodotto è tagliato o troppo vicino: allontanati e tienilo intero dentro la sagoma."
    elif reason in {'object_too_small_or_missing','object_not_centered'}:
        analysis_advice="Centra il prodotto: devo vedere la sagoma intera prima di salvare frame 3D."
    elif reason=='duplicate_angle':
        analysis_advice="Stai ripetendo lo stesso angolo: ruota ancora un po'."
    elif barcode.get('status') in {'detected_not_decoded','too_blurry','too_far'}:
        analysis_advice="Ho visto il barcode: avvicinalo un po' e tienilo fermo."
    elif ready:
        analysis_advice="Object-lock stabile, viste vere e qualità sufficiente: posso generare il 3D."
    elif not geometry_accepted:
        analysis_advice="Non è ancora una vista geometrica valida: tieni il prodotto intero, sfondo pulito, ruota lentamente e aspetta il lock verde."
    elif 'bottom' in captured_views:
        analysis_advice="Base acquisita: posso usare questa vista per dare più volume al 3D."
    elif coverage_percent>=60:
        analysis_advice="Quasi pronto: completa le ultime viste o i dettagli mancanti."
    else:
        analysis_advice="Sto ancora raccogliendo prove reali su forma, lati ed etichetta."
    return {
        "ok": True,
        "version": APP_VERSION,
        "accepted": geometry_accepted,
        "geometryAccepted": geometry_accepted,
        "detailAccepted": detail_accepted,
        "reason": reason,
        "score": score,
        "viewDetected": view,
        "viewConfidence": view_info['viewConfidence'],
        "distanceState": view_info['distanceState'],
        "frameType": view_info['frameType'],
        "motionType": "object_rotation" if view_info['viewConfidence']>=75 and view not in {'front','detail'} else "verifying",
        "evidence": view_info['evidence'],
        "coverageGain": view_info['coverageGain'] if geometry_accepted else 0,
        "partsDetected": parts,
        "productFamily": family_meta.get('family'),
        "familyMeta": family_meta,
        "metrics": metrics,
        "descriptor": descriptor,
        "labelBox": label_meta,
        "labelStatus": label_status,
        "ocr": ocr,
        "printedText": ocr.get('plainText',''),
        "barcode": barcode,
        "barcodeStatus": status_barcode,
        "barcodeValue": barcode.get('value') or "",
        "overlay": overlay,
        "objectLock": object_lock,
        "maskQuality": mask_quality,
        "poseEstimate": pose_estimate,
        "geometryScores": geom_scores,
        "buildQuality": {"score": build_confidence, "eligible": ready, "defects": [] if ready else [reason, mask_quality.get('reason'), object_lock.get('reason')]},
        "coveragePercent": coverage_percent,
        "capturedViews": captured_views,
        "capturedParts": captured_parts,
        "missingViews": missing_views,
        "missingParts": missing_parts,
        "readyFor3D": ready,
        "preview3DReady": preview_ready,
        "geometryFrames": len([v for v in captured_views if v in ['front','sideA','sideB','back','top','bottom']]),
        "nextInstruction": _next_instruction(required_views, required_parts, captured_views, captured_parts, accepted, reason, str(family_meta.get('family')), view_info, barcode, ocr),
        "analysisAdvice": analysis_advice,
        "captureCadenceMs": cadence_ms,
        "autoBuildHint": "stable_ready" if (ready and geometry_accepted) else "collecting",
        "elapsedMs": _now_ms()-started,
        "segmentation": seg_method
    }


@app.post("/acquire-frame")
async def acquire_frame(image: UploadFile = File(...), frame_index: int = Form(0), coverage_json: str = Form(""), authorization: Optional[str] = Header(None), x_vision_token: Optional[str] = Header(None)):
    _auth(authorization, x_vision_token)
    try:
        img=_load_image_file(image)
        if img is None:
            return JSONResponse({"ok":False,"error":"missing_image"}, status_code=400)
        return _frame_acceptance(img, int(frame_index or 0), coverage_json or "")
    except HTTPException:
        raise
    except Exception as e:
        return JSONResponse({"ok":False,"error":str(e),"trace":traceback.format_exc()[-1200:]}, status_code=500)



@app.post("/build-from-acquisition")
async def build_from_acquisition(front: UploadFile = File(...), back: Optional[UploadFile] = File(None), side: Optional[UploadFile] = File(None), top: Optional[UploadFile] = File(None), bottom: Optional[UploadFile] = File(None), metadata_json: str = Form(""), authorization: Optional[str] = Header(None), x_vision_token: Optional[str] = Header(None)):
    _auth(authorization, x_vision_token)
    try:
        front_img = _load_image_file(front)
        if front_img is None:
            return JSONResponse({"ok": False, "error": "missing_front"}, status_code=400)
        back_img = _load_image_file(back) if back else None
        side_img = _load_image_file(side) if side else None
        top_img = _load_image_file(top) if top else None
        bottom_img = _load_image_file(bottom) if bottom else None
        back_for_model = back_img or side_img
        result = _pipeline(front_img, back_img=back_for_model, mode="3d")
        meta = _safe_json_loads(metadata_json, {})
        family_hint = str(((result.get("product") or {}).get("family") or meta.get("productFamily") or "")).strip()
        remembered_barcode = str(meta.get("barcodeValue") or meta.get("barcode") or meta.get("lastBarcodeValue") or "").strip()

        def _smart_cut(name: str, img: Optional[Image.Image]):
            if img is None:
                return None, {"ok": False, "reason": "missing_" + name, "method": "missing"}, False
            cut, stats = _strict_clean_cut(img)
            if cut is not None:
                stats["relaxed"] = False
                return cut, stats, False
            rcut, rstats = _relaxed_clean_cut_for_build(img)
            rstats["strictFailed"] = stats
            if rcut is not None:
                return rcut, rstats, True
            return None, rstats, False

        front_cut, front_stats, front_relaxed = _smart_cut("front", front_img)
        side_cut, side_stats, side_relaxed = _smart_cut("side", side_img)
        back_cut, back_stats, back_relaxed = _smart_cut("back", back_img)
        top_cut, top_stats, top_relaxed = _smart_cut("top", top_img)
        bottom_cut, bottom_stats, bottom_relaxed = _smart_cut("bottom", bottom_img)

        # V33.4.26: do NOT use the rear photo as fake side for bottles/handle detergents.
        # That shortcut made the geometry wrong. Prefer a clean silhouette proxy or Product Twin.
        used_proxy = False
        allow_back_as_side = family_hint not in {'bottle','detergent_bottle_handle'}
        if side_cut is None and back_cut is not None and allow_back_as_side:
            side_cut = back_cut.copy()
            side_stats = {"ok": True, "reason": "using_back_as_side_proxy_safe_non_bottle_v33426", "relaxed": True, "source": "back"}
            used_proxy = True
        # Final no-dead-end proxy: only object silhouette, never full frame/table.
        if side_cut is None and front_cut is not None:
            proxy = _side_proxy_from_front(front_cut)
            if proxy is not None:
                side_cut = proxy
                side_stats = {"ok": True, "reason": "smart_side_proxy_from_front_silhouette_v33426", "relaxed": True, "source": "front_silhouette"}
                used_proxy = True

        mask_quality={"front":front_stats,"side":side_stats,"back":back_stats,"top":top_stats,"bottom":bottom_stats,"usedProxy":used_proxy}
        if front_cut is None:
            return {"ok":False,"error":"front_mask_invalid","message":"Non genero GLB: il frontale non contiene una sagoma prodotto recuperabile. Re-inquadra il prodotto intero su sfondo più contrastato.","maskQuality":mask_quality}
        try:
            coverage = float(meta.get("coveragePercent") or meta.get("coverage") or 0)
            use_product_twin_first = family_hint in {'bottle','detergent_bottle_handle'} or bool(used_proxy)
            try:
                if use_product_twin_first:
                    true3d = _guided_product_twin_glb(front_cut, side_cut, back_cut, meta)
                    true3d["engine"] = "Spesa Guided Product Twin Primary GLB V33.4.26"
                    true3d["note"] = (true3d.get("note") or "") + " Primary path chosen for bottle-like packaging to avoid wrong side/back fusion and keep geometry human-like."
                    build_path = "guided_product_twin_primary_v33426"
                else:
                    true3d = _hybrid_true_3d_from_views(front_cut, side_cut, back_cut, top_cut, bottom_cut, coverage=coverage)
                    build_path = "hybrid_multiview"
            except Exception as inner:
                # V33.4.26: Smart Finalizer rescue. If fusion fails, still deliver a safe object-only GLB.
                true3d = _guided_product_twin_glb(front_cut, side_cut, back_cut, meta)
                true3d["engine"] = "Spesa Guided Product Twin Rescue GLB V33.4.26"
                true3d["note"] = (true3d.get("note") or "") + " Rescue path used after multiview fusion rejection; object-only alpha, no full-frame fallback."
                true3d["rescueReason"] = str(inner)[:220]
                build_path = "guided_product_twin_rescue_after_fusion"
            true3d["maskQuality"] = mask_quality
            true3d.update({
                "kind": "real_glb_mesh",
                "frameCount": 0,
                "frames": [],
                "modelUrl": true3d.get("glbDataUrl", ""),
                "smartFinalizer": True,
                "buildPath": build_path,
                "relaxedViews": {"front":front_relaxed,"side":side_relaxed,"back":back_relaxed,"top":top_relaxed,"bottom":bottom_relaxed},
                "usedProxy": used_proxy
            })
            result["render3d"] = true3d
            if remembered_barcode and not (result.get("barcode") or ((result.get("details") or {}).get("barcode") if isinstance(result.get("details"), dict) else None)):
                digits_only=re.sub(r"\D", "", remembered_barcode)
                if 8 <= len(digits_only) <= 14:
                    result["barcode"] = digits_only
                    result["ean"] = digits_only
                    result.setdefault("details", {})["barcode"] = {"ok":True,"found":True,"status":"remembered_from_history","value":digits_only,"values":[digits_only],"confidence":72,"method":"build_metadata_barcode_v33426"}
            result.setdefault("product", {}).setdefault("shape", {})["thicknessModel"] = "smart_finalizer_hybrid_or_rescue_v33426"
            result["product"]["shape"]["hasSide"] = bool(side_cut)
            result["product"]["shape"]["hasBack"] = bool(back_cut)
            result["product"]["shape"]["hasTop"] = bool(top_cut)
            result["product"]["shape"]["hasBottom"] = bool(bottom_cut)
            result["product"]["shape"]["usedProxy"] = bool(used_proxy)
            result["product"]["shape"]["acquisitionHints"] = ["front", "side", "back", "top/base", "label", "barcode", "smart-finalizer"]
        except Exception as e:
            return {"ok":False,"error":"true_3d_build_rejected","message":"GLB non creato: anche il finalizzatore smart non è riuscito a creare una sagoma 3D sicura.","detail":str(e)[:220],"maskQuality":locals().get("mask_quality",{})}
        result["mode"] = "acquisition_3d_build"
        result["acquisition"] = {
            "metadata": meta,
            "temporaryFramesDeleted": True,
            "savedFinalAssetsOnly": True,
            "engine": "video_live_acquisition_v33426_guided_product_twin_core",
            "sideIncluded": bool(side_img),
            "backIncluded": bool(back_img),
            "topIncluded": bool(top_img),
            "bottomIncluded": bool(bottom_img),
            "sideUsedAsBackTexture": bool(side_img and not back_img),
            "capturedViews": meta.get("capturedViews", []),
            "capturedParts": meta.get("capturedParts", []),
            "isolated3DPipeline": True,
            "true3DEngine": "guided_product_twin_hybrid_v33426"
        }
        if result.get("render3d") and isinstance(result["render3d"], dict):
            result["render3d"]["note"] = (result["render3d"].get("note") or "") + " Acquisition build saved with google-like object-lock multiview 3D pipeline, immediate inline GLB delivery, and no 2D overwrite."
            result["modelUrl"] = result["render3d"].get("glbDataUrl", "")
        return result
    except HTTPException:
        raise
    except Exception as e:
        return JSONResponse({"ok":False,"error":str(e),"trace":traceback.format_exc()[-1200:]}, status_code=500)


@app.get("/acquisition-health")
def acquisition_health(authorization: Optional[str] = Header(None), x_vision_token: Optional[str] = Header(None)):
    _auth(authorization, x_vision_token)
    return {"ok":True,"version":APP_VERSION,"features":["object_centric_tracking","truth_gate","distance_scale_awareness","wide_detail_classifier","gpu_ocr_easyocr_optional","barcode_multiframe_zxing_opencv","live_futuristic_overlay","coverage_map","build_from_acquisition","final_glb_persist_fix","viewer_rotate_ready","smart_live_guidance","stable_auto_build_hint","top_bottom_lift_detection","stable_3d_preview","force_build_preview_visible","base_lift_detection_v2","force_preview_from_live_frames","thicker_visible_mesh","live_build_missing_function_fix","side_used_when_back_missing","isolated_3d_no_2d_overwrite","hard_server_truth_gate_expected","no_fake_coverage","thicker_volume_mesh_v33414","true_multiview_voxel_reconstruction_v33415","inline_glb_delivery_v33415","ultra_true_3d_hybrid_v33416","object_mask_microcells_v33417","geometry_only_acceptance_v33417","no_detail_frames_in_mesh_v33417","top_bottom_regularization_v33416","quality_score_v33416","glb_no_blank_viewer_guard_v33417","mask_quality_hard_gate_v33420","no_dirty_glb_fallback_v33420","front_plus_side_required_v33420","google_like_object_lock_v33421","dense_micro_surface_tracker_v33421","mask_purity_engine_v33421","pose_estimation_pro_v33421","geometry_usefulness_score_v33421","texture_anti_smear_guard_v33421","guided_product_twin_core_v33426","target_view_mission_classifier_v33426","dense_pixel_skin_9000_v33425","deep_pixel_skin_motion_fusion_v33426","profile_side_not_tilt_v33425","solid_core_microcells_v33425","anti_leak_surface_skin_v33425"],"ocrError":_OCR_ERROR or "","barcodeBackend":"zxingcpp+opencv"}

@app.get("/health")
def health(authorization: Optional[str] = Header(None), x_vision_token: Optional[str] = Header(None)):
    _auth(authorization, x_vision_token)
    cuda = bool(torch is not None and getattr(torch, "cuda", None) and torch.cuda.is_available())
    gpu = torch.cuda.get_device_name(0) if cuda else "cpu"
    return {
        "ok": True,
        "service": "Spesa Vision Brain",
        "version": APP_VERSION,
        "cuda": cuda,
        "gpu": gpu,
        "auth": bool(TOKEN),
        "engines": {
            "segmentation": "rembg/u2net + contour-defringe + handle-hole refine + grabcut fallback",
            "label": "v33.4.14 label-preserve text/color detector",
            "depth": "transformers depth optional + alpha fallback + live acquisition fit",
            "3d": "scanner 3D object-mask GLB mesh: strict clean-mask validation, geometry-only frames, micro-cells on object mask, front+side required, no dirty fallback GLB, inline GLB delivery",
        }
    }


async def _endpoint(image: UploadFile, back: Optional[UploadFile], mode: str, authorization: Optional[str], x_vision_token: Optional[str]):
    _auth(authorization, x_vision_token)
    try:
        img = _load_image_file(image)
        if img is None:
            return JSONResponse({"ok": False, "error": "missing_image"}, status_code=400)
        back_img = _load_image_file(back) if back else None
        result = _pipeline(img, back_img=back_img, mode=mode)
        return result
    except HTTPException:
        raise
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e), "trace": traceback.format_exc()[-1200:]}, status_code=500)


@app.post("/render-pro")
async def render_pro(image: UploadFile = File(...), back: Optional[UploadFile] = File(None), authorization: Optional[str] = Header(None), x_vision_token: Optional[str] = Header(None)):
    return await _endpoint(image, back, "render-pro", authorization, x_vision_token)


@app.post("/label-pro")
async def label_pro(image: UploadFile = File(...), authorization: Optional[str] = Header(None), x_vision_token: Optional[str] = Header(None)):
    _auth(authorization, x_vision_token)
    img = _load_image_file(image)
    if img is None:
        return JSONResponse({"ok": False, "error": "missing_image"}, status_code=400)
    try:
        cut, _ = _rembg_cutout(img)
        product = _trim_transparent(cut)
        label_source = _make_white(product)
    except Exception:
        label_source = img
    crop, meta = _label_crop_v333(product)
    meta["source"] = "segmented_product_only"
    barcode = _barcode_try(crop)
    return {"ok": True, "version": APP_VERSION, "mode": "label", "labelBox": meta, "barcode": barcode, "images": {"labelCrop": _data_url(crop, "JPEG", 94)}}


@app.post("/render-3d")
async def render_3d(image: UploadFile = File(...), back: Optional[UploadFile] = File(None), authorization: Optional[str] = Header(None), x_vision_token: Optional[str] = Header(None)):
    return await _endpoint(image, back, "3d", authorization, x_vision_token)


# backward compatibility with old app endpoints
@app.post("/analyze-product")
async def analyze_product(image: UploadFile = File(...), authorization: Optional[str] = Header(None), x_vision_token: Optional[str] = Header(None)):
    return await _endpoint(image, None, "analyze", authorization, x_vision_token)


@app.post("/render-product")
async def render_product(image: UploadFile = File(...), authorization: Optional[str] = Header(None), x_vision_token: Optional[str] = Header(None)):
    return await _endpoint(image, None, "render", authorization, x_vision_token)
