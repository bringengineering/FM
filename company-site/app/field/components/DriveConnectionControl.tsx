"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { driveTokenManager } from "../lib/drive-auth.client";
import { DRIVE_ROOT_FOLDER_ID } from "../lib/drive-folders";
import { GoogleDriveClient } from "../lib/google-drive.client";

const serverSnapshot = { status: "disconnected" } as const;

export default function DriveConnectionControl({
  onConnected,
}: {
  onConnected?: () => void | Promise<void>;
}) {
  const snapshot = useSyncExternalStore(
    driveTokenManager.subscribe,
    driveTokenManager.snapshot,
    () => serverSnapshot,
  );
  const [validationError, setValidationError] = useState<string>();
  const autoConnectStarted = useRef(false);

  const connect = async () => {
    if (snapshot.status === "connecting") return;
    setValidationError(undefined);
    try {
      await driveTokenManager.connect();
      const client = new GoogleDriveClient({ getAccessToken: driveTokenManager.getAccessToken });
      await client.validateWritableRoot(DRIVE_ROOT_FOLDER_ID);
      await onConnected?.();
    } catch (error) {
      const code = error instanceof Error ? error.message : "drive_authorization_failed";
      setValidationError(code === "drive_root_access_denied"
        ? "지정한 BRING Drive 폴더의 편집 권한을 확인해 주세요."
        : "Google Drive 연결에 실패했습니다. 회사 계정으로 다시 연결해 주세요.");
    }
  };

  useEffect(() => {
    if (autoConnectStarted.current || snapshot.status !== "disconnected") return;
    autoConnectStarted.current = true;
    void connect();
  });

  const connected = snapshot.status === "connected" && !validationError;
  return (
    <div className="field-drive-control">
      <button
        type="button"
        className={`field-drive-status ${connected ? "connected" : ""}`}
        onClick={() => void connect()}
        disabled={snapshot.status === "connecting"}
      >
        <span aria-hidden="true" />
        {snapshot.status === "connecting"
          ? "Drive 연결 중…"
          : connected
            ? "Drive 연결됨"
            : "Google Drive 연결"}
      </button>
      {validationError ? <small role="alert">{validationError}</small> : null}
    </div>
  );
}
