/**
 * Перенос проверенной логики из старого Don/index.html в модульную Nova-архитектуру.
 * Здесь только клиентские утилиты: секреты и права доступа остаются на сервере/Firebase Rules.
 */

export type Coordinates = { lat: number; lng: number; accuracy?: number };

export function distanceKm(a: Coordinates, b: Coordinates): number {
  const rad = (n: number) => (n * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

/** Уменьшает изображение до JPEG перед отправкой, чтобы не гонять оригиналы. */
export async function compressImage(
  file: File,
  maxDimension = 1280,
  quality = 0.72,
): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new Error("Выбранный файл не является изображением");
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = objectUrl;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Не удалось прочитать изображение"));
    });
    const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas недоступен");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        blob => (blob ? resolve(blob) : reject(new Error("Не удалось сжать изображение"))),
        "image/jpeg",
        quality,
      );
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** Получает координаты только после явного действия пользователя. */
export function getCurrentCoordinates(): Promise<Coordinates> {
  if (!("geolocation" in navigator)) return Promise.reject(new Error("Геолокация не поддерживается"));
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      position => resolve({
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy,
      }),
      reject,
      { enableHighAccuracy: false, maximumAge: 120_000, timeout: 10_000 },
    );
  });
}

/** Узкие ограничения для WebRTC: экономия трафика, аудио включено всегда. */
export const AUDIO_CALL_CONSTRAINTS: MediaStreamConstraints = {
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  video: false,
};

export const VIDEO_CALL_CONSTRAINTS: MediaStreamConstraints = {
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  video: {
    facingMode: "user",
    width: { ideal: 640, max: 960 },
    height: { ideal: 360, max: 540 },
    frameRate: { ideal: 20, max: 24 },
  },
};

/** Ограничивает исходящий SDP для Opus и видео, если браузер поддерживает эти параметры. */
export function optimizeCallSdp(sdp: string, video: boolean): string {
  let result = sdp;
  if (!/maxaveragebitrate=/.test(result)) {
    result = result.replace(
      /a=rtpmap:(\d+) opus\/48000\/2/g,
      (_match, payload: string) =>
        `a=rtpmap:${payload} opus/48000/2\r\na=fmtp:${payload} minptime=10;useinbandfec=1;maxaveragebitrate=32000`,
    );
  }
  if (video && !/b=AS:/.test(result)) {
    result = result.replace(/(m=video [^\r\n]+)/g, "$1\r\nb=AS:350");
  }
  return result;
}

/** Базовый STUN. Для надёжных соединений между сложными NAT потребуется TURN. */
export const WEBRTC_ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
];
