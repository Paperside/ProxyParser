import { useState } from "react";
import { toast } from "sonner";

import { SectionTitle } from "../shared";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Field, Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { useWorkspace } from "./context";

// JSON 编辑小区块（dns / tun / sniffer 均为对象）
const JsonSection = ({
  label,
  value,
  onSave
}: {
  label: string;
  value: Record<string, unknown> | undefined;
  onSave: (next: Record<string, unknown> | undefined) => void;
}) => {
  const [text, setText] = useState(value ? JSON.stringify(value, null, 2) : "");
  const [editing, setEditing] = useState(false);

  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <span className="text-xs font-medium text-muted">{label}</span>
        {!editing ? (
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            编辑
          </Button>
        ) : (
          <>
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                if (text.trim() === "") {
                  onSave(undefined);
                  setEditing(false);
                  return;
                }
                try {
                  onSave(JSON.parse(text) as Record<string, unknown>);
                  setEditing(false);
                } catch {
                  toast.error(`${label} 不是合法 JSON`);
                }
              }}
            >
              保存
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              取消
            </Button>
          </>
        )}
      </div>
      {editing ? (
        <Textarea value={text} onChange={(event) => setText(event.target.value)} className="min-h-32" />
      ) : (
        <pre className="max-h-40 overflow-auto rounded-md border border-line bg-bg px-3 py-2 font-mono text-[11px] text-muted">
          {value ? JSON.stringify(value, null, 2) : "（未设置）"}
        </pre>
      )}
    </div>
  );
};

export const ConfigTab = () => {
  const { config, update } = useWorkspace();
  const structured = config.config.structured;
  const [rawPatch, setRawPatch] = useState(config.config.rawPatch ?? "");

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <SectionTitle title="配置" desc="常用字段用表单；其余顶层配置走 YAML 补丁（发布前会校验）。" />

      <Card className="grid grid-cols-3 gap-3.5">
        <Field label="混合端口 mixed-port">
          <Input
            value={structured.ports?.mixedPort ?? ""}
            placeholder="7890"
            onChange={(event) =>
              update((draft) => {
                const port = Number(event.target.value);
                draft.config.structured.ports = {
                  ...draft.config.structured.ports,
                  mixedPort: Number.isInteger(port) && port > 0 ? port : undefined
                };
              })
            }
          />
        </Field>
        <Field label="模式 mode">
          <Select
            value={structured.mode ?? "rule"}
            onValueChange={(mode) =>
              update((draft) => {
                draft.config.structured.mode = mode as "rule" | "global" | "direct";
              })
            }
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="rule" description="按规则分流">rule</SelectItem>
              <SelectItem value="global" description="全部走代理">global</SelectItem>
              <SelectItem value="direct" description="全部直连">direct</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="日志级别 log-level">
          <Select
            value={structured.logLevel ?? "info"}
            onValueChange={(level) =>
              update((draft) => {
                draft.config.structured.logLevel = level as typeof structured.logLevel;
              })
            }
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {["silent", "error", "warning", "info", "debug"].map((level) => (
                <SelectItem key={level} value={level}>{level}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </Card>

      <Card className="flex flex-col gap-4">
        <JsonSection
          label="DNS"
          value={structured.dns}
          onSave={(next) => update((draft) => { draft.config.structured.dns = next; })}
        />
        <JsonSection
          label="TUN"
          value={structured.tun}
          onSave={(next) => update((draft) => { draft.config.structured.tun = next; })}
        />
        <JsonSection
          label="Sniffer"
          value={structured.sniffer}
          onSave={(next) => update((draft) => { draft.config.structured.sniffer = next; })}
        />
      </Card>

      <Card>
        <div className="mb-1.5 flex items-center gap-2">
          <span className="text-xs font-medium text-muted">YAML 补丁（逃生舱）</span>
          <Button
            size="sm"
            onClick={() =>
              update((draft) => {
                draft.config.rawPatch = rawPatch.trim() === "" ? null : rawPatch;
              })
            }
          >
            保存补丁
          </Button>
        </div>
        <Textarea
          value={rawPatch}
          onChange={(event) => setRawPatch(event.target.value)}
          placeholder={"unified-delay: true\ntcp-concurrent: true"}
          className="min-h-28"
        />
        <p className="mt-1.5 text-[11px] text-faint">
          深合并到顶层配置。proxies / proxy-groups / rules / rule-providers 不允许在此修改——请到对应模块编辑。
        </p>
      </Card>
    </div>
  );
};
