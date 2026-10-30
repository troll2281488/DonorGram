import { get, ref, set } from "firebase/database";
import { realtimeDb } from "../firebase";
import { compressImage } from "./donorgram";
import { cacheMedia, readCachedMedia, pruneMediaCache } from "./mediaCache";

export type MediaKind = "image" | "video" | "audio" | "file";
export type UploadedMedia = {
  storagePath: string;
  mediaType: MediaKind;
  contentType: string;
  size: number;
  name: string;
};

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_VIDEO_BYTES = 3 * 1024 * 1024;
const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
const MAX_FILE_BYTES = 2 * 1024 * 1024;

function mediaKind(file: File): MediaKind {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return "file";
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Не удалось прочитать файл"));
    reader.onerror = () => reject(new Error("Ошибка чтения файла"));
    reader.readAsDataURL(blob);
  });
}

/**
 * Совместимый с прежним DonorGram режим без Firebase Storage:
 * сжатый файл хранится в Realtime Database. Лимиты намеренно небольшие,
 * поскольку Base64 заметно увеличивает объём и стоимость трафика.
 */
export async function uploadRoomMedia(roomId: string, uid: string, file: File): Promise<UploadedMedia> {
  if (!realtimeDb) throw new Error("Firebase Realtime Database не подключена");
  if (!roomId || !uid) throw new Error("Не указан чат или пользователь");
  const kind = mediaKind(file);
  const maxBytes = kind === "image" ? MAX_IMAGE_BYTES : kind === "video" ? MAX_VIDEO_BYTES : kind === "audio" ? MAX_AUDIO_BYTES : MAX_FILE_BYTES;
  if (file.size > maxBytes) throw new Error(`Файл слишком большой. Лимит без Storage: ${Math.round(maxBytes / 1024 / 1024)} МБ`);
  if (kind === "file" && (!file.type || file.type === "application/x-msdownload")) throw new Error("Этот тип файла не поддерживается");

  const body = kind === "image" ? await compressImage(file, 1280, 0.68) : file;
  if (body.size > maxBytes) throw new Error("После обработки файл превышает лимит передачи без Storage");
  const contentType = kind === "image" ? "image/jpeg" : (file.type || "application/octet-stream");
  const storagePath = `rtdb-media/rooms/${roomId}/${uid}/${crypto.randomUUID()}`;
  const dataUrl = await readAsDataUrl(body);
  await set(ref(realtimeDb, storagePath), {
    dataUrl, contentType, name: file.name.slice(0, 180), size: body.size,
    ownerUid: uid, roomId, createdAt: Date.now()
  });
  try { await cacheMedia(storagePath, body); void pruneMediaCache(); } catch { /* local cache is an optimization only */ }
  return { storagePath, mediaType: kind, contentType, size: body.size, name: file.name.slice(0, 180) };
}

/** Читает файл только после нажатия пользователем на его вложение. */
export async function getRoomMediaUrl(storagePath: string): Promise<string> {
  if (!realtimeDb || !storagePath.startsWith("rtdb-media/rooms/")) throw new Error("Некорректный путь вложения");
  const cached = await readCachedMedia(storagePath).catch(() => null);
  if (cached) return URL.createObjectURL(cached);
  const snap = await get(ref(realtimeDb, storagePath));
  const data = snap.val() as { dataUrl?: string } | null;
  if (!data?.dataUrl || typeof data.dataUrl !== "string") throw new Error("Файл не найден");
  const response = await fetch(data.dataUrl);
  const blob = await response.blob();
  try { await cacheMedia(storagePath, blob); void pruneMediaCache(); } catch { /* cache failure must not block opening */ }
  return URL.createObjectURL(blob);
}

export async function deleteRoomMedia(storagePath: string): Promise<void> {
  if (!realtimeDb || !storagePath.startsWith("rtdb-media/rooms/")) return;
  await set(ref(realtimeDb, storagePath), null);
}
