// background/mediaHelpers.js — MimicVault
// MIME/ヘッダ推定ヘルパー getHeader/inferMimeFromUrl/resolveTag

"use strict";

// ─── ヘルパー ─────────────────────────────────────────────────────────────────

function getHeader(headers, name) {
  const lower = name.toLowerCase();
  return headers.find(h => h.name.toLowerCase() === lower)?.value ?? null;
}

function inferMimeFromUrl(url) {
  const ext = (url.match(/\.([a-z0-9]+)(\?|#|$)/i) ?? [])[1]?.toLowerCase();
  const table = {
    mp4: "video/mp4",   webm: "video/webm",  mkv: "video/x-matroska",
    mov: "video/quicktime", m4v: "video/mp4", ogg: "video/ogg",
    ogv: "video/ogg",   ts: "video/mp2t",    m2ts: "video/mp2t",
    m4s: "video/iso.segment", m3u8: "application/x-mpegURL",
    mpd: "application/dash+xml", mp3: "audio/mpeg",
    aac: "audio/aac",   flac: "audio/flac",  opus: "audio/opus",
    m4a: "audio/mp4",   wav: "audio/wav",
  };
  return table[ext] ?? "video/*";
}

function resolveTag(mime) {
  return /^audio\//i.test(mime) ? "audio" : "video";
}

