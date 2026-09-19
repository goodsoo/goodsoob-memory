import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import {
  exportMeetingSections,
  SECTION_LABELS,
  sectionFilename,
  sectionHasContent,
} from "../../lib/meetingExport";
import type {
  MeetingMarkdownInput,
  MeetingMarkdownSection,
} from "../../lib/markdown";
import { formatError } from "../../lib/errors";
import { Modal } from "../common/Modal";
import { Button } from "../common/Button";
import { Text } from "../common/Text";
import { useToast } from "../Toast";

const SECTION_ORDER: MeetingMarkdownSection[] = ["body", "transcript", "summary"];

type Props = {
  // 내보낼 메모 (full — body/transcript/summary 채워진 상태). null 이면 닫힘.
  meeting: MeetingMarkdownInput | null;
  onClose: () => void;
};

// 내보내기 섹션 선택 모달 — 메모/음성기록/요약 중 고른 섹션을 폴더 안에 각각 .md 로.
// 본문은 제목 그대로, 음성기록·요약은 제목 뒤 라벨. 사이드바·타이틀바 공용.
export function MeetingExportModal({ meeting, onClose }: Props) {
  const toast = useToast();
  const [selected, setSelected] = useState<Set<MeetingMarkdownSection>>(
    () => new Set(),
  );
  const [submitting, setSubmitting] = useState(false);

  // 열릴 때마다 내용 있는 섹션만 기본 체크.
  useEffect(() => {
    if (!meeting) return;
    setSelected(
      new Set(SECTION_ORDER.filter((s) => sectionHasContent(meeting, s))),
    );
    setSubmitting(false);
  }, [meeting]);

  if (!meeting) return null;

  const available = SECTION_ORDER.filter((s) => sectionHasContent(meeting, s));

  function toggle(section: MeetingMarkdownSection) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  }

  function handleExport() {
    if (submitting || !meeting) return;
    const sections = SECTION_ORDER.filter((s) => selected.has(s));
    if (sections.length === 0) return;
    setSubmitting(true);
    try {
      const written = exportMeetingSections(meeting, sections);
      toast.show(`${written.length}개 파일을 다운로드합니다.`, { kind: "info" });
      onClose();
    } catch (e) {
      toast.show(formatError(e));
      setSubmitting(false);
    }
  }

  return (
    <Modal open ariaLabel="내보내기" onClose={onClose} size="sm">
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ borderBottom: "1px solid var(--line-2)" }}
      >
        <div className="min-w-0">
          <Text variant="body" weight="semibold" as="div">
            내보내기
          </Text>
          <Text
            variant="caption"
            color="muted"
            as="div"
            truncate
            className="mt-0.5"
          >
            {meeting.title?.trim() || "(제목 없음)"}
          </Text>
        </div>
        <Button
          variant="icon"
          onClick={onClose}
          aria-label="닫기"
          style={{ color: "var(--faint)" }}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="px-3 py-3">
        {available.length === 0 ? (
          <Text variant="caption" color="muted" as="div" className="px-1 py-2">
            내보낼 내용이 없습니다.
          </Text>
        ) : (
          <div className="space-y-1">
            {available.map((s) => {
              const checked = selected.has(s);
              return (
                <Button
                  key={s}
                  variant="ghost"
                  role="menuitemcheckbox"
                  aria-checked={checked}
                  onClick={() => toggle(s)}
                  className="w-full justify-start gap-2 px-2 py-1.5"
                  style={{ color: "var(--ink)" }}
                >
                  <span
                    className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm"
                    style={{
                      border: `1px solid ${checked ? "var(--btn-primary)" : "var(--line)"}`,
                      backgroundColor: checked
                        ? "var(--btn-primary)"
                        : "transparent",
                    }}
                  >
                    {checked ? (
                      <svg
                        viewBox="0 0 12 12"
                        className="h-3 w-3"
                        style={{ color: "var(--btn-primary-text)" }}
                        aria-hidden
                      >
                        <path
                          d="M2.5 6.5l2.2 2.2 4.8-5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    ) : null}
                  </span>
                  <span className="flex-1 text-left">{SECTION_LABELS[s]}</span>
                  <Text
                    variant="caption"
                    color="muted"
                    as="span"
                    className="truncate"
                  >
                    {sectionFilename(meeting.title, s)}
                  </Text>
                </Button>
              );
            })}
          </div>
        )}
      </div>

      <div
        className="flex items-center justify-end gap-2 px-3 py-3"
        style={{ borderTop: "1px solid var(--line-2)" }}
      >
        <Button variant="secondary" size="sm" onClick={onClose}>
          취소
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={handleExport}
          disabled={submitting || selected.size === 0}
          leftIcon={<Download className="h-3.5 w-3.5" />}
          className="disabled:opacity-50"
        >
          내보내기
        </Button>
      </div>
    </Modal>
  );
}
