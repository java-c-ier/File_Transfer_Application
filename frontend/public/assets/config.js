/**
 * Runtime configuration — loaded before the React app bundle.
 *
 * In production (Docker/k8s), this file is replaced at deploy time
 * via a volume mount or ConfigMap so URLs can change without rebuilding
 * the frontend image.
 *
 * For local development the values below point to localhost.
 */
window.APP_CONFIG = {
  /** Full base URL of the backend API (no trailing slash) */
  appBaseUrl: "https://apps.trisysit.com/transfer-backend",
};
