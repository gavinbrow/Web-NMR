/** Folder drops retain paths, so identically named vendor files stay grouped. */
export async function droppedFiles(transfer: DataTransfer): Promise<File[]> {
  const files: File[] = [];
  let bytes = 0;
  async function walk(entry: FileSystemEntry, prefix = "") {
    const path = prefix + entry.name;
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) =>
        (entry as FileSystemFileEntry).file(resolve, reject),
      );
      bytes += file.size;
      if (files.length >= 3000 || bytes > 256 * 1024 * 1024)
        throw new Error(
          "Folder exceeds the 3,000 file or 256 MB local import limit. Use a smaller experiment folder.",
        );
      Object.defineProperty(file, "webkitRelativePath", { value: path });
      files.push(file);
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      let children: FileSystemEntry[];
      do {
        children = await new Promise<FileSystemEntry[]>((resolve, reject) =>
          reader.readEntries(resolve, reject),
        );
        for (const child of children) await walk(child, path + "/");
      } while (children.length);
    }
  }
  // Snapshot entries before the drop event's data store becomes inaccessible.
  const entries = Array.from(transfer.items)
    .filter((item) => item.kind === "file")
    .map((item) => item.webkitGetAsEntry?.())
    .filter((entry): entry is FileSystemEntry => !!entry);
  if (entries.length) {
    for (const entry of entries) await walk(entry);
    return files;
  }
  return Array.from(transfer.files);
}
