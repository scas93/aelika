import Card from "../../_components/Card";

export function CanalCardShell({
  emoji,
  iconBg,
  iconColor,
  titulo,
  className = "",
  children,
}: {
  emoji: string;
  iconBg: string;
  iconColor: string;
  titulo: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className={`flex flex-col gap-3 ${className}`}>
      <div className="flex items-center gap-3">
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xl"
          style={{ backgroundColor: iconBg, color: iconColor }}
        >
          {emoji}
        </span>
        <span className="text-sm font-extrabold text-admin-ink">{titulo}</span>
      </div>
      {children}
    </Card>
  );
}
