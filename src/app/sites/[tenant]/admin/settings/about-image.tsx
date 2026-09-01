"use client";

import { useActionState } from "react";
import {
  uploadAboutImageAction,
  removeAboutImageAction,
  type AboutImageState,
} from "../actions";

/**
 * The About photo, uploaded on its own.
 *
 * It is a separate <form> because HTML forbids nesting one form inside
 * another, and the settings form posts plain fields rather than multipart.
 * Keeping it separate also means a failed upload never discards the text the
 * owner just typed.
 */
export function AboutImage({ imageUrl }: { imageUrl: string | null }) {
  const [state, action, pending] = useActionState<AboutImageState, FormData>(
    uploadAboutImageAction,
    {},
  );

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>About photo</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        Shown beside your About text — your shop front, your family, or your
        display. Under 3 MB — JPG, PNG, WebP or GIF.
      </p>

      {state.error ? <div className="notice error">{state.error}</div> : null}
      {state.ok ? <div className="notice ok">Photo saved.</div> : null}

      {imageUrl ? (
        <div style={{ marginBottom: 12 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt="Current About photo"
            style={{ maxWidth: 260, borderRadius: 8, display: "block" }}
          />
        </div>
      ) : null}

      <form action={action}>
        <div className="field">
          <input type="file" name="image" accept="image/jpeg,image/png,image/webp,image/gif" />
        </div>
        <button className="btn" type="submit" disabled={pending}>
          {pending ? "Uploading..." : imageUrl ? "Replace photo" : "Upload photo"}
        </button>
      </form>

      {imageUrl ? (
        <form action={removeAboutImageAction} style={{ marginTop: 10 }}>
          <button
            type="submit"
            className="muted"
            style={{
              background: "none",
              border: 0,
              cursor: "pointer",
              textDecoration: "underline",
              color: "var(--err)",
              fontSize: 12,
            }}
          >
            Remove this photo
          </button>
        </form>
      ) : null}
    </div>
  );
}
