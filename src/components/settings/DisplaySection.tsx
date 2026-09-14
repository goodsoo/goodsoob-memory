import { Minus, Plus, RotateCcw } from "lucide-react";
import { isTauri } from "../../lib/isTauri";
import { useZoom } from "../../hooks/useZoom";
import { Button } from "../common/Button";
import { Text } from "../common/Text";
import { Kbd } from "../common/Kbd";

export function DisplaySection() {
  const { percent, zoomIn, zoomOut, reset, canZoomIn, canZoomOut, isDefault } =
    useZoom();

  return (
    <div className="space-y-6">
      <section>
        <Text
          variant="caption"
          color="muted"
          as="h3"
          weight="semibold"
          className="mb-2 uppercase tracking-wide"
        >
          화면 배율
        </Text>
        <Text variant="body" color="secondary" as="p" className="mb-4">
          글자가 작아 잘 보이지 않을 때 앱 전체를 확대합니다. 설정한 배율은 다음 실행에도 유지됩니다.
        </Text>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            onClick={zoomOut}
            disabled={!canZoomOut}
            title="축소  ⌘−"
            aria-label="축소"
          >
            <Minus className="h-4 w-4" />
          </Button>
          <div className="min-w-[3.5rem] text-center">
            <Text variant="body" weight="semibold" as="span">
              {percent}%
            </Text>
          </div>
          <Button
            variant="secondary"
            onClick={zoomIn}
            disabled={!canZoomIn}
            title="확대  ⌘+"
            aria-label="확대"
          >
            <Plus className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            onClick={reset}
            disabled={isDefault}
            title="100% 로 복귀  ⌘0"
            className="ml-1 gap-1.5"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            기본값
          </Button>
        </div>
      </section>

      <section>
        <Text
          variant="caption"
          color="muted"
          as="h3"
          weight="semibold"
          className="mb-2 uppercase tracking-wide"
        >
          단축키
        </Text>
        <ul className="space-y-2">
          {[
            { keys: ["⌘", "+"], label: "확대" },
            { keys: ["⌘", "−"], label: "축소" },
            { keys: ["⌘", "0"], label: "100% 로 복귀" },
          ].map((s) => (
            <li
              key={s.label}
              className="flex items-center gap-3 py-1"
            >
              <Text variant="body" as="span" className="min-w-0 flex-1">
                {s.label}
              </Text>
              <div className="flex shrink-0 items-center gap-1">
                {s.keys.map((k, i) => (
                  <Kbd
                    key={i}
                    className="h-6 min-w-[1.5rem] px-1.5 text-xs"
                    style={{
                      backgroundColor: "var(--bg)",
                      color: "var(--sub)",
                    }}
                  >
                    {k}
                  </Kbd>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {!isTauri && (
        <Text
          variant="caption"
          color="secondary"
          as="p"
          className="rounded px-3 py-2"
          style={{
            background: "var(--bg)",
            border: "1px solid var(--line-2)",
          }}
        >
          단축키는 데스크탑 앱 (Tauri) 전용입니다. 브라우저에선 시스템 단축키와 충돌해 동작하지 않습니다.
        </Text>
      )}
    </div>
  );
}
