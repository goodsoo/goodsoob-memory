import { useId, useState } from "react";
import { Alert, Button, Field, Input, Modal, useToast } from "@goodsoob/ds";
import { useDiarizeRecording } from "../../hooks/useRecordings";
import type { RecordingItem } from "../../lib/recordings/merge";
import {
  MAX_NAME_LEN,
  MAX_SPEAKERS,
  MIN_SPEAKERS,
  buildNames,
  diarizeEstimate,
  processingErrorMessage,
  validateSpeakers,
} from "../../lib/recordings/processing";
import { Text } from "../common/Text";

export const REDIARIZE_WARNING = "다시 나누면 지금까지 고친 내용과 찾은 고칠 곳이 사라집니다.";

type Props = {
  item: RecordingItem;
  open: boolean;
  onClose: () => void;
  /** ⋯ 메뉴 "말한 사람 다시 나누기" 로 열었으면 true — 경고를 함께 보여 줍니다. */
  rediarize?: boolean;
};

/** 말한 사람 나누기 창 (화자분리 job 시작). 인원 수 비우면 자동 판정. */
export function SplitSpeakersDialog({ item, open, onClose, rediarize = false }: Props) {
  const title = rediarize ? "말한 사람 다시 나누기" : "말한 사람 나누기";
  return (
    <Modal open={open} onClose={onClose} size="sm" backdrop="scrim" ariaLabel={title}>
      {open ? <SplitForm item={item} title={title} rediarize={rediarize} onClose={onClose} /> : null}
    </Modal>
  );
}

function SplitForm({
  item,
  title,
  rediarize,
  onClose,
}: {
  item: RecordingItem;
  title: string;
  rediarize: boolean;
  onClose: () => void;
}) {
  const { entry } = item;
  const toast = useToast();
  const diarize = useDiarizeRecording();
  const [speakersRaw, setSpeakersRaw] = useState(""); // 빈 값 = 자동
  const [nameInputs, setNameInputs] = useState<string[]>([]);
  const check = validateSpeakers(speakersRaw);
  const estimate = diarizeEstimate(entry.durationSec);
  const local = "이 맥에서 처리하며 외부로 보내지 않습니다.";
  const guide =
    check.ok && check.speakers === 0
      ? `비우면 목소리로 인원을 판단합니다. ${MAX_SPEAKERS}명이 넘으면 인원 수를 입력하세요. ${local}`
      : `이름은 첫 번째 사람부터 차례로 입력합니다. ${local}`;

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
        onSuccess: () => {
          toast.show("말한 사람 나누기를 시작했습니다.", { variant: "ok" });
          onClose();
        },
        onError: (err) => toast.show(processingErrorMessage(err), { variant: "down" }),
      },
    );
  }

  // 슬롯(Header/Body/Footer)은 패널 바로 아래 있어야 하므로 form 은 Body 안에 두고
  // 푸터의 제출 버튼은 form 속성으로 연결한다.
  const formId = useId();
  return (
    <>
      <Modal.Header>
        <Text variant="h4" as="h2">
          {title}
        </Text>
      </Modal.Header>
      <Modal.Body>
        <form
          id={formId}
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!diarize.isPending) submit();
          }}
        >
          {rediarize ? <Alert variant="warn">{REDIARIZE_WARNING}</Alert> : null}
          <Field label="인원 수" layout="vertical" hint={`비우면 자동, ${MIN_SPEAKERS}~${MAX_SPEAKERS}명`}>
            <Input
              type="number"
              inputMode="numeric"
              min={MIN_SPEAKERS}
              max={MAX_SPEAKERS}
              step={1}
              value={speakersRaw}
              onChange={(e) => setSpeakersRaw(e.target.value)}
              placeholder="인원 수를 입력하세요"
              autoFocus
            />
          </Field>
          {check.ok && check.speakers > 0 ? (
            <div className="grid grid-cols-2 gap-3">
              {Array.from({ length: check.speakers }, (_, i) => (
                <Field key={i} layout="vertical" label={`${i + 1}번째 사람 이름 (선택)`}>
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
                    placeholder="이름을 입력하세요"
                  />
                </Field>
              ))}
            </div>
          ) : null}
          <Text variant="caption" color="muted" as="div">
            {guide}
            {estimate ? ` ${estimate}` : ""}
          </Text>
        </form>
      </Modal.Body>
      <Modal.Footer>
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            취소
          </Button>
          <Button type="submit" form={formId} variant="primary" disabled={diarize.isPending || !check.ok}>
            나누기
          </Button>
        </div>
      </Modal.Footer>
    </>
  );
}
