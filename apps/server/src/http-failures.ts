import { CloudConfigConflictError } from "./pds.ts";
import { CustomBundleError } from "./custom-module-bundle.ts";

export function saveFailure(error: unknown) {
  if (error instanceof CloudConfigConflictError)
    return { error: "configuration-changed", message: error.message };
  const value = error as { status?: number; error?: string; message?: string };
  const detail = `${value?.error ?? ""} ${value?.message ?? ""}`.toLowerCase();
  if (value?.status === 429 || /rate.?limit/.test(detail))
    return {
      error: "pds-rate-limited",
      message:
        "Your PDS is temporarily rate limiting configuration changes. Your saved settings are unchanged. Try again after the rate limit resets.",
    };
  if (value?.error === "BlobNotFound")
    return {
      error: "pds-blob-missing",
      message:
        "An attached media file is no longer available on your PDS. Attach it again and retry saving.",
    };
  if (
    value?.status === 401 ||
    value?.status === 403 ||
    /unauthor|forbidden|scope|permission/.test(detail)
  )
    return {
      error: "pds-write-not-authorized",
      message: "Your ATProto session does not grant access to write these records.",
    };
  if (/invalidswap|swap|concurrent/.test(detail))
    return {
      error: "configuration-changed",
      message: "The PDS configuration changed since it was loaded. Reload and try again.",
    };
  if (/lexicon|record|schema|validation/.test(detail))
    return {
      error: "pds-rejected-record",
      message: "Your PDS rejected the Streamface record format.",
    };
  return {
    error: "save-failed",
    message: "Your PDS could not save the configuration.",
  };
}
export function uploadFailure(error: unknown) {
  if (error instanceof CustomBundleError)
    return { status: 400, body: { error: "invalid-bundle", message: error.message } };
  const value = error as { status?: number; error?: string; message?: string };
  const detail = `${value?.error ?? ""} ${value?.message ?? ""}`.toLowerCase();
  if (
    error instanceof RangeError ||
    value?.status === 413 ||
    /too large|size limit|payload/.test(detail)
  )
    return {
      status: 413,
      body: {
        error: "upload-too-large",
        message: "This file is larger than the 10 MB upload limit.",
      },
    };
  if (error instanceof TypeError || /unsupported media|mime|content.?type/.test(detail))
    return {
      status: 415,
      body: {
        error: "unsupported-media",
        message: "This file type is not supported. Choose media or a ZIP app.",
      },
    };
  if (
    value?.status === 401 ||
    value?.status === 403 ||
    /unauthor|forbidden|scope|permission|session/.test(detail)
  )
    return {
      status: 403,
      body: {
        error: "pds-upload-not-authorized",
        message: "Your ATProto session cannot upload media. Sign in again to grant media access.",
      },
    };
  if (value?.status === 429 || /rate.?limit/.test(detail))
    return {
      status: 429,
      body: {
        error: "pds-upload-rate-limited",
        message: "Your PDS is temporarily rate limiting uploads. Wait a moment and try again.",
      },
    };
  if (/empty media/.test(detail))
    return {
      status: 400,
      body: { error: "empty-upload", message: "The selected file is empty." },
    };
  return {
    status: 502,
    body: {
      error: "pds-upload-failed",
      message: "Your PDS rejected the media upload. Try another supported file or sign in again.",
    },
  };
}
