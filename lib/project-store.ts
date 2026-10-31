import type { Aspect, AudioClip, Clip, Lut, Marker, OverlayClip, Quality, TitleCard } from "@/lib/types";

const DB_NAME = "luce";
const DB_VERSION = 1;

export type SavedProject = {
  version: 1;
  aspect: Aspect;
  quality: Quality;
  clips: Clip[];
  overlays: OverlayClip[];
  audios: AudioClip[];
  titles: TitleCard[];
  markers: Marker[];
  luts: Lut[];
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("media")) db.createObjectStore("media");
      if (!db.objectStoreNames.contains("project")) db.createObjectStore("project");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("idb"));
  });
}

function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("idb"));
  });
}

export async function saveProject(project: SavedProject, media: Map<string, Blob>): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["media", "project"], "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("idb"));
    const blobs = tx.objectStore("media");
    blobs.clear();
    for (const [id, blob] of media) blobs.put(blob, id);
    tx.objectStore("project").put(project, "current");
  });
  db.close();
}

export async function loadProject(): Promise<{ project: SavedProject; urls: Map<string, string> } | null> {
  const db = await openDb();
  const project = await done(db.transaction("project").objectStore("project").get("current") as IDBRequest<SavedProject | undefined>);
  if (!project) {
    db.close();
    return null;
  }
  const mediaTx = db.transaction("media");
  const store = mediaTx.objectStore("media");
  const [keys, media] = await Promise.all([
    done(store.getAllKeys() as IDBRequest<IDBValidKey[]>),
    done(store.getAll() as IDBRequest<Blob[]>),
  ]);
  db.close();
  const urls = new Map<string, string>();
  keys.forEach((key, index) => {
    const blob = media[index];
    if (blob) urls.set(String(key), URL.createObjectURL(blob));
  });
  return { project, urls };
}

export async function clearProject(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["media", "project"], "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("idb"));
    tx.objectStore("media").clear();
    tx.objectStore("project").clear();
  });
  db.close();
}

export function attachUrls<T extends { mediaId: string; url: string }>(items: T[], urls: Map<string, string>): T[] {
  return items.flatMap((item) => {
    const url = urls.get(item.mediaId);
    return url ? [{ ...item, url }] : [];
  });
}
