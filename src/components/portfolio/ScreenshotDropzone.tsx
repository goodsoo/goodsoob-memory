import { useState } from "react";
import { Upload } from "lucide-react";
import type { PortfolioScreenshot, ScreenshotLabel } from "../../api/portfolio";
import { useVault } from "../../lib/vault/useVault";
import { useUpdatePortfolioFrontmatter } from "../../hooks/usePortfolio";
import { saveScreenshot } from "../../lib/portfolio/screenshot";

type Props = {
  prSlug: string;
  existing: PortfolioScreenshot[];
  label: ScreenshotLabel;
};

// PNG/JPG drop or click-to-select → 1600px JPEG → vault binary write → frontmatter patch.
export function ScreenshotDropzone({ prSlug, existing, label }: Props) {
  const { adapter } = useVault();
  const updateFm = useUpdatePortfolioFrontmatter(prSlug);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFiles = async (files: FileList | File[]) => {
    const root = adapter.getRoot();
    if (!root) {
      setError("vault 가 설정되지 않았어요");
      return;
    }
    const arr = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (arr.length === 0) {
      setError("이미지 파일만 업로드 가능");
      return;
    }
    setError(null);
    setUploading(true);
    try {
      const next: PortfolioScreenshot[] = [...existing];
      for (const file of arr) {
        const saved = await saveScreenshot({
          adapter,
          prSlug,
          file,
          label,
        });
        next.push({ path: saved.path, label, caption: "" });
      }
      updateFm.mutate({ screenshots: next });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  };

  return (
    <label
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files.length > 0) {
          void handleFiles(e.dataTransfer.files);
        }
      }}
      className="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-md border border-dashed px-3 py-3 text-xs transition"
      style={{
        borderColor: dragOver ? "var(--accent)" : "var(--line)",
        backgroundColor: dragOver ? "var(--accent-soft)" : "transparent",
        color: "var(--sub)",
      }}
    >
      <input
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            void handleFiles(e.target.files);
            e.target.value = "";
          }
        }}
      />
      <Upload className="h-4 w-4" />
      <span>
        {uploading
          ? "업로드 중..."
          : label === "before"
          ? "Before 이미지 드롭/클릭"
          : label === "after"
          ? "After 이미지 드롭/클릭"
          : "이미지 드롭/클릭"}
      </span>
      {error ? (
        <span style={{ color: "var(--down-ink)" }}>{error}</span>
      ) : null}
    </label>
  );
}
