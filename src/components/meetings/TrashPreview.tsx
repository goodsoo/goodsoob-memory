import { Trash2 } from "lucide-react";
import { useDeletedMeetings } from "../../hooks/useMeetings";
import { formatDateLong } from "../../lib/dates";
import { MarkdownView } from "./MarkdownView";
import { Text } from "../common/Text";

// 휴지통 파일명 stamp prefix — SidePanel.tsx 와 동일 정규식.
const STAMP_PREFIX = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-/;

function stripTrashStamp(title: string | null | undefined): string {
  return (title ?? "").replace(STAMP_PREFIX, "");
}

export function TrashPreview({ selectedId }: { selectedId: string | null }) {
  const { data, isLoading } = useDeletedMeetings();

  if (isLoading) {
    return <Empty>불러오는 중...</Empty>;
  }
  if (!data || data.length === 0) {
    return (
      <Empty>
        <Trash2 className="mx-auto mb-3 h-8 w-8 opacity-40" />
        <div>휴지통이 비어 있어요</div>
      </Empty>
    );
  }
  const meeting = selectedId ? data.find((m) => m.id === selectedId) : null;
  if (!meeting) {
    return <Empty>휴지통에서 메모를 선택하세요</Empty>;
  }

  const title = stripTrashStamp(meeting.title).trim() || "(제목 없음)";
  const attendees = Array.isArray(meeting.attendees)
    ? meeting.attendees.filter(Boolean).join(", ")
    : meeting.attendees ?? "";
  const hasSummary = (meeting.summary ?? "").trim().length > 0;

  return (
    <article className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <Text
          variant="caption"
          color="muted"
          as="div"
          className="mb-4 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1"
          style={{ backgroundColor: "var(--surface)" }}
        >
          <Trash2 className="h-3 w-3" />
          휴지통 미리보기 · 읽기 전용
        </Text>
        <Text variant="h1" weight="semibold" as="h1">
          {title}
        </Text>
        <Text
          variant="body"
          color="muted"
          as="div"
          className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1"
        >
          {meeting.date ? <span>{formatDateLong(meeting.date)}</span> : null}
          {meeting.time ? <span>{meeting.time}</span> : null}
          {attendees ? <span>참석 {attendees}</span> : null}
        </Text>

        <hr
          className="my-6"
          style={{ borderColor: "var(--line-2)" }}
        />

        {meeting.content?.trim() ? (
          <section className="mb-8">
            <MarkdownView content={meeting.content} />
          </section>
        ) : null}

        {meeting.transcript?.trim() ? (
          <section className="mb-8">
            <Text
              variant="body"
              color="secondary"
              as="h2"
              weight="medium"
              className="mb-2"
            >
              음성 기록
            </Text>
            <pre
              className="whitespace-pre-wrap rounded-lg px-4 py-3 text-sm"
              style={{
                backgroundColor: "var(--surface)",
                color: "var(--ink)",
                fontFamily: "inherit",
              }}
            >
              {meeting.transcript}
            </pre>
          </section>
        ) : null}

        {hasSummary ? (
          <section className="mb-8">
            <Text
              variant="body"
              color="secondary"
              as="h2"
              weight="medium"
              className="mb-2"
            >
              요약
            </Text>
            <div
              className="rounded-lg px-4 py-3"
              style={{ backgroundColor: "var(--surface)" }}
            >
              <MarkdownView content={meeting.summary} />
            </div>
          </section>
        ) : null}

        {!meeting.content?.trim() &&
        !meeting.transcript?.trim() &&
        !hasSummary ? (
          <Text variant="body" color="muted" as="div" className="italic">
            (내용 없음)
          </Text>
        ) : null}
      </div>
    </article>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center">
      <Text variant="body" color="muted" as="div" className="text-center">
        {children}
      </Text>
    </div>
  );
}
