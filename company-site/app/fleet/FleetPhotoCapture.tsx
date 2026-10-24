"use client";
/* eslint-disable @next/next/no-img-element -- camera previews use local object URLs */

import { useEffect, useRef, useState } from "react";

export default function FleetPhotoCapture({
  file,
  onChange,
}: {
  file?: File;
  onChange(file?: File): void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string>();
  const previewRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    };
  }, []);

  const select = (selected?: File) => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    const url = selected ? URL.createObjectURL(selected) : undefined;
    previewRef.current = url;
    setPreviewUrl(url);
    onChange(selected);
  };

  const retake = () => {
    select(undefined);
    if (inputRef.current) {
      inputRef.current.value = "";
      inputRef.current.click();
    }
  };

  return (
    <section className="fleet-photo-capture">
      <label className="fleet-camera-button">
        <span>{file ? "촬영 사진 변경" : "계기판 사진 촬영"}</span>
        <input
          ref={inputRef}
          aria-label="계기판 사진 촬영"
          name="photo"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          required
          onChange={(event) => select(event.currentTarget.files?.[0])}
        />
      </label>
      {previewUrl ? (
        <div className="fleet-photo-preview">
          <img src={previewUrl} alt="촬영한 계기판 미리보기" />
          <div>
            <b>{file?.name}</b>
            <span>출발 km 숫자가 선명하게 보이는지 확인해 주세요.</span>
          </div>
          <button type="button" onClick={retake}>다시 촬영</button>
        </div>
      ) : <p>계기판 전체와 숫자가 함께 보이도록 촬영해 주세요.</p>}
    </section>
  );
}
