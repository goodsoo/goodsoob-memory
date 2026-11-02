import { useState } from "react";
import { Alert, Field, Input, useToast } from "@goodsoob/ds";
import type { RecordingItem } from "../../lib/recordings/merge";
import {
  MAX_NAME_LEN,
  MAX_SPEAKERS,
  MIN_SPEAKERS,
  buildNames,
  diarizeEstimate,
  errorIsDiarize,
  failedChunksText,
  jobErrorText,
  processingErrorMessage,
  stepLabel,
  validateSpeakers,
} from "../../lib/recordings/processing";
import { useCorrectionsRecording, useDiarizeRecording } from "../../hooks/useRecordings";
import { Button } from "../common/Button";
import { Text } from "../common/Text";

/**
 * 전사 처리 패널 (PR2). 행선지와 무관하게 파이프라인 상태로만 결정된다.
 * 초벌 전사 -> 화자분리 -> 교정 후보 -> (리뷰는 PR3).
 */
export function ProcessingPanel({ item }: { item: RecordingItem }) {
  const { entry, status } = item;
  const { pipeline } = status;
  const job = entry.job;
  if (!entry.hasM4a) return null;

  if (pipeline === "processing") {
    return (
      <Alert variant="info" title="처리 중입니다">
        {stepLabel(job?.step)}. 이 화면을 닫아도 계속 진행됩니다.
      </Alert>
    );
  }
  if (pipeline === "raw") {
    return (
      <Section title="전사 처리">
        <DiarizeForm item={item} actionLabel="화자분리" />
      </Section>
    );
  }
  if (pipeline === "correction") {
    return (
      <Section title="전사 처리">
        <CorrectionsAction base={entry.base} />
        <details className="text-sm">
          <summary className="cursor-pointer" style={{ color: "var(--text-secondary)" }}>
            화자를 다시 나누기
          </summary>
          <div className="pt-3">
            <DiarizeForm item={item} actionLabel="화자분리 다시 실행" variant="secondary" />
          </div>
        </details>
      </Section>
    );
  }
  if (pipeline === "error") {
    return (
      <Section title="전사 처리">
        <Alert variant="down" title="처리에 실패했습니다">
          {jobErrorText(job)}
          {failedChunksText(job?.failedChunks) ? ` ${failedChunksText(job?.failedChunks)}` : ""}
        </Alert>
        {errorIsDiarize(job, entry.stt.diarized) ? (
          entry.stt.done ? (
            <DiarizeForm item={item} actionLabel="재실행" />
          ) : null
        ) : (
          <CorrectionsAction base={entry.base} rerun failedChunks={job?.failedChunks} />
        )}
      </Section>
    );
  }
  if (pipeline === "review") {
    const misses = job?.anchorMisses ?? 0;
    return (
      <Section title="전사 처리">
        <Alert variant="ok" title="교정 후보가 준비되었습니다">
          리뷰는 다음 업데이트에서 지원합니다.
          {misses > 0 ? ` 위치를 찾지 못한 후보 ${misses}개` : ""}
        </Alert>
      </Section>
    );
  }
  return null;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <Text variant="body" weight="semibold" as="h4">
        {title}
      </Text>
      {children}
    </section>
  );
}

function DiarizeForm({
  item,
  actionLabel,
  variant = "primary",
}: {
  item: RecordingItem;
  actionLabel: string;
  variant?: "primary" | "secondary";
}) {
  const { entry } = item;
  const toast = useToast();
  const diarize = useDiarizeRecording();
  const [speakersRaw, setSpeakersRaw] = useState("2");
  const [nameInputs, setNameInputs] = useState<string[]>([]);
  const check = validateSpeakers(speakersRaw);
  const estimate = diarizeEstimate(entry.durationSec);

  function submit() {
    if (!check.ok) {
      toast.show(check.message, { variant: "down" });
      return;
    }
    const names = buildNames(nameInputs, check.speakers);
    if (!names.ok) {
      toast.show(names.message, { variant: "down" });
      return;
    }
    diarize.mutate(
      { base: entry.base, speakers: check.speakers, names: names.names },
      {
        onSuccess: () => toast.show("화자분리를 시작했습니다.", { variant: "ok" }),
        onError: (err) => toast.show(processingErrorMessage(err), { variant: "down" }),
      },
    );
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!diarize.isPending) submit();
      }}
    >
      <Field label="화자 수" required hint={`${MIN_SPEAKERS}~${MAX_SPEAKERS}명`}>
        <Input
          type="number"
          inputMode="numeric"
          min={MIN_SPEAKERS}
          max={MAX_SPEAKERS}
          step={1}
          value={speakersRaw}
          onChange={(e) => setSpeakersRaw(e.target.value)}
          placeholder="화자 수를 입력하세요"
        />
      </Field>
      {check.ok
        ? Array.from({ length: check.speakers }, (_, i) => (
            <Field key={i} label={`화자 ${i + 1} 이름`}>
              <Input
                value={nameInputs[i] ?? ""}
                maxLength={MAX_NAME_LEN}
                onChange={(e) =>
                  setNameInputs((prev) => {
                    const next = [...prev];
                    next[i] = e.target.value;
                    return next;
                  })
                }
                placeholder={`화자 ${i + 1} 이름을 입력하세요`}
              />
            </Field>
          ))
        : null}
      <Text variant="caption" color="muted" as="div">
        이름은 선택 사항이며 앞 화자부터 차례로 입력합니다. 화자분리는 이 맥에서 실행되며 녹음 길이의 약 4분의 1이 걸립니다.
        {estimate ? ` ${estimate}` : ""}
      </Text>
      <Button type="submit" variant={variant} size="sm" disabled={diarize.isPending || !check.ok}>
        {actionLabel}
      </Button>
    </form>
  );
}

function CorrectionsAction({
  base,
  rerun = false,
  failedChunks,
}: {
  base: string;
  rerun?: boolean;
  failedChunks?: number[];
}) {
  const toast = useToast();
  const corrections = useCorrectionsRecording();
  const canRetryFailed = !!failedChunks && failedChunks.length > 0;

  function run(retryFailed: boolean) {
    corrections.mutate(
      { base, retryFailed },
      {
        onSuccess: () => toast.show("교정 후보 만들기를 시작했습니다.", { variant: "ok" }),
        onError: (err) => toast.show(processingErrorMessage(err), { variant: "down" }),
      },
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {canRetryFailed ? (
          <Button variant="primary" size="sm" disabled={corrections.isPending} onClick={() => run(true)}>
            실패한 부분만 재실행
          </Button>
        ) : null}
        <Button
          variant={canRetryFailed ? "secondary" : "primary"}
          size="sm"
          disabled={corrections.isPending}
          onClick={() => run(false)}
        >
          {rerun ? "재실행" : "교정 후보 만들기"}
        </Button>
      </div>
      <Text variant="caption" color="muted" as="div">
        전사 내용이 Claude 로 전송됩니다.
      </Text>
    </div>
  );
}
