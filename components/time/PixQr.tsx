"use client";

import { useEffect, useState } from "react";

export function PixQr({ payload }: { payload: string }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    void import("qrcode").then((QR) => {
      QR.toDataURL(payload, { width: 220, margin: 1, errorCorrectionLevel: "M" })
        .then((url) => {
          if (ativo) setSrc(url);
        })
        .catch(() => {
          if (ativo) setSrc(null);
        });
    });
    return () => {
      ativo = false;
    };
  }, [payload]);

  if (!src) return <div className="item-estorno-qr-loading">Gerando QR…</div>;
  return <img src={src} alt="QR Code PIX" className="item-estorno-qr" width={220} height={220} />;
}
