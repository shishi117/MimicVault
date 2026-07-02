// background/companion.js — MimicVault
// Native Messaging companion connectCompanion/sendToCompanion ほか

"use strict";

// ─── Native Messaging Companion（ステップ15/16） ──────────────────────────────
/**
 * companion app（Node.js + FFmpeg）との通信レイヤー。
 *
 * 設計方針:
 *   - companion が未インストールでも拡張機能の基本機能は動く（グレースフルフォールバック）
 *   - companion 接続中は HLS ダウンロードが FFmpeg 経由の MP4 変換パスを通る
 *   - companion が切断・失敗した場合は従来の blob ダウンロード（.ts）に自動フォールバック
 *
 * companion との通信は browser.runtime.connectNative() のポートで行う。
 * 複数リクエストを同一ポートで処理するため requestId でルーティングする。
 *
 *   拡張機能 → companion: { type, requestId, ...params }
 *   companion → 拡張機能: { requestId, type: "progress", ... }  (変換中、複数回)
 *                          { requestId, ok: true, ...result }    (完了)
 *                          { requestId, ok: false, error }       (失敗)
 */

/** companion app の Native Messaging ホスト名（native-manifest.json の "name" と一致） */
const COMPANION_HOST = "mimic_vault";

/** 現在のポート（null = 未接続） */
let companionPort   = null;

/** 現在の接続状態 */
let companionStatus = "disconnected"; // "disconnected" | "connected" | "error"

/**
 * 進行中リクエストのマップ。
 * key: requestId (number)
 * value: { resolve, reject, onProgress? }
 */
const companionPendingRequests = new Map();

/** 次に発行する requestId */
let companionNextRequestId = 1;

/**
 * companion app に接続する。
 * すでに接続済みの場合は何もしない。
 * インストールされていない場合はグレースフルに失敗（ステータスを "error" に設定）。
 */
function connectCompanion() {
  if (companionPort) return; // 既に接続済み

  // ステップ18: 設定で companion 機能が無効化されていれば接続しない
  if (settingsCache.companionEnabled === false) {
    companionStatus = "disabled";
    broadcastCompanionStatus();
    return;
  }

  try {
    companionPort = browser.runtime.connectNative(COMPANION_HOST);
    companionStatus = "connected";
    broadcastCompanionStatus();

    companionPort.onMessage.addListener((msg) => {
      const req = companionPendingRequests.get(msg.requestId);
      if (!req) return; // 対応するリクエストがなければ無視

      if (msg.type === "progress") {
        // 変換中の進捗通知
        req.onProgress?.(msg);
      } else if (msg.ok === true) {
        // 完了（成功）
        companionPendingRequests.delete(msg.requestId);
        req.resolve(msg);
      } else if (msg.ok === false) {
        // 完了（失敗）
        companionPendingRequests.delete(msg.requestId);
        req.reject(new Error(msg.error ?? "companion error"));
      }
    });

    companionPort.onDisconnect.addListener(() => {
      // companion が切断（アプリ終了 / インストール未了 / エラー）
      companionPort   = null;
      companionStatus = browser.runtime.lastError ? "error" : "disconnected";
      // 進行中のすべてのリクエストをエラーにする
      for (const req of companionPendingRequests.values()) {
        req.reject(new Error("companion disconnected"));
      }
      companionPendingRequests.clear();
      broadcastCompanionStatus();
    });

  } catch (err) {
    companionPort   = null;
    companionStatus = "error";
    broadcastCompanionStatus();
  }
}

/**
 * companion にコマンドを送信してレスポンスを返す Promise。
 *
 * @param {object} command     - 送信するコマンド（type + params）
 * @param {function} onProgress - 進捗通知コールバック（省略可）
 * @returns {Promise<object>}
 */
function sendToCompanion(command, onProgress) {
  return new Promise((resolve, reject) => {
    if (!companionPort) {
      reject(new Error("companion not connected"));
      return;
    }
    const requestId = companionNextRequestId++;
    companionPendingRequests.set(requestId, { resolve, reject, onProgress });
    try {
      companionPort.postMessage({ ...command, requestId });
    } catch (err) {
      companionPendingRequests.delete(requestId);
      reject(err);
    }
  });
}

/**
 * companion の接続状態変化をポップアップに通知する。
 * ポップアップが閉じている場合は無視する。
 */
function broadcastCompanionStatus() {
  browser.runtime.sendMessage({
    type:   "COMPANION_STATUS",
    status: companionStatus,
  }).catch(() => {});
}

// 起動時に companion への接続を試みる（未インストールでも失敗するだけ）
connectCompanion();

// ─── メッセージルーターへの companion 関連ハンドラ追加 ─────────────────────────
// （下記は既存の addListener の switch 文に追加するのではなく、
//    別の addListener として定義する）
browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {
    case "GET_COMPANION_STATUS":
      sendResponse({ status: companionStatus });
      return true;

    case "CONNECT_COMPANION":
      // ポップアップの「再接続」ボタンなどから手動で呼び出す用
      if (!companionPort) {
        companionStatus = "disconnected"; // エラー状態をリセット
        connectCompanion();
      }
      sendResponse({ status: companionStatus });
      return true;

    default:
      break;
  }
});

