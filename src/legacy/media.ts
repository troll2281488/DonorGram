import { deleteObject, getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { storage } from "../firebase";
import { compressImage } from "./donorgram";

export type MediaKind = "image" | "video" | "file";
export type UploadedMedia = {
  storagePath: string;
  mediaType: MediaKind;
  contentType: string;
  size: number;
  name: string;
};

const MAX_IMAGE_BYTES = 18 * 1024 * 1024;
const MAX_VIDEO_BYTES = 80 * 1024 * 1024;
const MAX_FILE_BYTES = 20 * 1024 * 1024;

function mediaKind(file: File): MediaKind {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  return "file";
}

/**
 * Загружает бинарные данные в Storage, а не в документ Firestore.
 * Изображения предварительно уменьшаются; видео/файлы ограничены по размеру.
 */
export async function uploadRoomMedia(
  roomId: string,
  uid: string,
  file: File,
): Promise<UploadedMedia> {
  if (!storage) throw new Error("Firebase Storage не подключён");
  if (!roomId || !uid) throw new Error("Не указан чат или пользователь");

  const kind = mediaKind(file);
  const maxBytes = kind === "image" ? MAX_IMAGE_BYTES : kind === "video" ? MAX_VIDEO_BYTES : MAX_FILE_BYTES;
  if (file.size > maxBytes) {
    throw new Error(`Файл слишком большой. Лимит: ${Math.round(maxBytes / 1024 / 1024)} МБ`);
  }
  if (kind === "file" && (!file.type || file.type === "application/x-msdownload")) {
    throw new Error("Этот тип файла не поддерживается");
  }

  const body = kind === "image" ? await compressImage(file, 1280, 0.7) : file;
  const contentType = kind === "image" ? "image/jpeg" : (file.type || "application/octet-stream");
  const extension = kind === "image" ? "jpg" : (file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  const storagePath = `rooms/${roomId}/${uid}/${crypto.randomUUID()}.${extension}`;
  const target = ref(storage, storagePath);
  await uploadBytes(target, body, {
    contentType,
    customMetadata: { ownerUid: uid, roomId, originalName: file.name.slice(0, 180) },
  });

  return {
    storagePath,
    mediaType: kind,
    contentType,
    size: body.size,
    name: file.name.slice(0, 180),
  };
}

/** URL запрашивается только при открытии вложения, а не при загрузке истории чата. */
export function getRoomMediaUrl(storagePath: string): Promise<string> {
  if (!storage || !storagePath.startsWith("rooms/")) {
    return Promise.reject(new Error("Некорректный путь вложения"));
  }
  return getDownloadURL(ref(storage, storagePath));
}

export async function deleteRoomMedia(storagePath: string): Promise<void> {
  if (!storage || !storagePath.startsWith("rooms/")) return;
  await deleteObject(ref(storage, storagePath));
}
