import { useCallback, useEffect, useRef, useState } from "react";
import { StickyNote } from "lucide-react";
import { useScratch, useSaveScratch } from "../../hooks/useScratch";
import { useDebouncedSave } from "../../hooks/useDebouncedSave";
import { SaveIndicator } from "../common/SaveIndicator";
import { Text } from "../common/Text";

// 높이 조절 — 사이드바 너비 조절처럼 위쪽 경계선 드래그. localStorage 저장 + 더블클릭 복귀.
const QC_HEIGHT_KEY = "goodsoob:quickCaptureHeight";
const QC_MIN = 96;
const QC_MAX = 600;
const QC_DEFAULT = 180;

function clampHeight(n: number): number {
  return Math.min(QC_MAX, Math.max(QC_MIN, n));
}

function loadHeight(): number {
  try {
    const raw = localStorage.getItem(QC_HEIGHT_KEY);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? clampHeight(n) : QC_DEFAULT;
  } catch {
    return QC_DEFAULT;
  }
}

// 빠른 캡처 — 날짜에 안 묶인 포스트잇. "오늘" 사이드바 하단에 항상 고정(아젠다 스크롤
// 밖). vault root scratchpad.md 에 평문 자동저장. 떠오른 걸 탭 안 옮기고 바로 던져두는 용도.
// 높이는 위쪽 경계선을 잡고 드래그해 조절(사이드바 너비 조절과 동일한 손맛).
export function QuickCapturePanel() {
  const scratchQ = useScratch();
  const saveScratch = useSaveScratch();

  const [content, setContent] = useState("");
  const inited = useRef(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const [height, setHeight] = useState(loadHeight);
  const draggingRef = useRef(false);
  const startRef = useRef({ y: 0, h: QC_DEFAULT });

  const save = useCallback(
    async (value: string) => {
      await saveScratch.mutateAsync(value);
    },
    [saveScratch],
  );

  const { schedule, flush, status } = useDebouncedSave<string>({ save });

  // 쿼리 로드되면 1회 초기화. 이후 자동저장 결과(캐시 갱신)가 입력을 덮어쓰지 않게 ref 가드.
  useEffect(() => {
    if (scratchQ.isLoading || inited.current) return;
    inited.current = true;
    setContent(scratchQ.data ?? "");
  }, [scratchQ.isLoading, scratchQ.data]);

  // 언마운트(탭 전환 등) 시 pending 저장 flush.
  useEffect(() => {
    return () => {
      void flush();
    };
  }, [flush]);

  // 높이 저장.
  useEffect(() => {
    try {
      localStorage.setItem(QC_HEIGHT_KEY, String(height));
    } catch {
      // ignore
    }
  }, [height]);

  // 경계선 드래그 — 위로 끌면 커지고 아래로 끌면 작아짐(시작점 기준 delta).
  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!draggingRef.current) return;
      setHeight(clampHeight(startRef.current.h + (startRef.current.y - e.clientY)));
    }
    function onUp() {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  function startDrag(e: React.MouseEvent) {
    e.preventDefault();
    draggingRef.current = true;
    startRef.current = { y: e.clientY, h: height };
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
  }

  return (
    <div className="flex shrink-0 flex-col" style={{ height: `${height}px` }}>
      {/* 위쪽 경계선 = 높이 조절 핸들(드래그). 더블클릭 = 기본 높이로. */}
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-valuenow={height}
        aria-valuemin={QC_MIN}
        aria-valuemax={QC_MAX}
        onMouseDown={startDrag}
        onDoubleClick={() => setHeight(QC_DEFAULT)}
        title="드래그해서 높이 조절"
        className="group relative h-2 shrink-0 cursor-row-resize"
        style={{ borderTop: "1px solid var(--line)" }}
      >
        {/* hover 시 잡는 선 강조 */}
        <div
          className="absolute inset-x-0 top-0 h-0.5 opacity-0 transition-opacity group-hover:opacity-100"
          style={{ backgroundColor: "var(--accent)" }}
        />
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-3 pb-2.5 pt-1">
        <div className="mb-1.5 flex items-center gap-1.5">
          <StickyNote
            className="h-3.5 w-3.5 shrink-0"
            style={{ color: "var(--faint)" }}
            aria-hidden
          />
          <Text
            variant="caption"
            weight="semibold"
            as="span"
            style={{ color: "var(--sub)" }}
          >
            빠른 캡처
          </Text>
          {status !== "idle" ? (
            <span className="ml-auto">
              <SaveIndicator
                isPending={status === "pending" || status === "saving"}
                isError={status === "error"}
              />
            </span>
          ) : null}
        </div>
        <textarea
          ref={taRef}
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            schedule(e.target.value);
          }}
          onBlur={() => void flush()}
          placeholder="떠오른 생각을 적어두세요"
          className="min-h-0 w-full flex-1 resize-none rounded-md px-2 py-1.5 text-[13px] leading-relaxed outline-none"
          style={{
            backgroundColor: "var(--bg)",
            border: "1px solid var(--line)",
            color: "var(--ink)",
          }}
        />
      </div>
    </div>
  );
}
