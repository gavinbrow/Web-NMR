import type { Spectrum } from "../model";

/** Accept both current fields and aliases retained in older imported projects. */
export function spectrumText(s: Pick<Spectrum, "label" | "metadata">) {
  const firstText = (keys: string[]) => {
    for (const key of keys) {
      const value = s.metadata[key];
      if (typeof value === "string" && value.trim())
        return value.replace(/\r\n?/g, "\n");
    }
    return "";
  };
  return {
    title: firstText(["title", "Title", "TITLE"]) || s.label,
    comments: firstText([
      "comments",
      "comment",
      "Comment",
      "Comments",
      "COMMENT",
      "COMMENTS",
    ]),
  };
}

export function spectrumDescription(s: Pick<Spectrum, "label" | "metadata">) {
  const { title, comments } = spectrumText(s);
  return [title, comments].filter(Boolean).join("\n");
}
