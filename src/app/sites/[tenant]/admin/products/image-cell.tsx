"use client";

import { useActionState, useRef } from "react";
import {
  uploadProductImageAction,
  removeProductImageAction,
  type ImageState,
} from "../actions";

/**
 * Per-row photo control.
 *
 * Submits on file selection rather than behind a separate "Upload" button: a
 * shop adding photos to 200 products should not click twice per row.
 */
export function ImageCell({
  productId,
  imageUrl,
  productName,
}: {
  productId: string;
  imageUrl: string | null;
  productName: string;
}) {
  const [state, action, pending] = useActionState<ImageState, FormData>(
    uploadProductImageAction,
    {},
  );
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <div style={{ minWidth: 96 }}>
      <form ref={formRef} action={action}>
        <input type="hidden" name="productId" value={productId} />
        <label
          style={{
            display: "block",
            cursor: pending ? "wait" : "pointer",
            opacity: pending ? 0.5 : 1,
          }}
        >
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={productName}
              width={64}
              height={64}
              style={{
                width: 64,
                height: 64,
                objectFit: "cover",
                borderRadius: 6,
                border: "1px solid var(--line)",
                display: "block",
              }}
            />
          ) : (
            <span
              style={{
                display: "flex",
                width: 64,
                height: 64,
                alignItems: "center",
                justifyContent: "center",
                border: "1px dashed var(--line)",
                borderRadius: 6,
                fontSize: 11,
                color: "var(--muted)",
                textAlign: "center",
              }}
            >
              {pending ? "..." : "Add photo"}
            </span>
          )}
          <input
            type="file"
            name="image"
            accept="image/jpeg,image/png,image/webp,image/gif"
            hidden
            disabled={pending}
            onChange={() => formRef.current?.requestSubmit()}
          />
        </label>
      </form>

      {state.error ? (
        <div className="muted" style={{ color: "var(--err)", fontSize: 11, marginTop: 4 }}>
          {state.error}
        </div>
      ) : null}

      {imageUrl ? (
        <form action={removeProductImageAction}>
          <input type="hidden" name="productId" value={productId} />
          <button
            type="submit"
            className="muted"
            style={{
              background: "none",
              border: 0,
              padding: "2px 0",
              fontSize: 11,
              cursor: "pointer",
              textDecoration: "underline",
            }}
          >
            Remove
          </button>
        </form>
      ) : null}
    </div>
  );
}
