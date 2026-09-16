import {
  Badge,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger
} from "@carbon/react";
import { Enumerable } from "./Enumerable";

type EnumerableGroupItem = {
  label: string;
  onClick?: () => void;
};

type EnumerableGroupProps = {
  items: EnumerableGroupItem[];
  limit?: number;
};

// Single-line sibling of AvatarGroup for Enumerable chips: the first `limit`
// render inline and the rest collapse behind a +N chip revealed on hover, so
// a list cell never wraps and every table row keeps the same height.
const EnumerableGroup = ({ items, limit = 2 }: EnumerableGroupProps) => {
  if (items.length === 0) return null;
  const visible = items.slice(0, limit);
  const overflow = items.slice(limit);

  const chip = (item: EnumerableGroupItem) => (
    <Enumerable
      key={item.label}
      value={item.label}
      onClick={item.onClick}
      className={item.onClick ? "cursor-pointer" : undefined}
    />
  );

  return (
    <span className="flex items-center gap-2 whitespace-nowrap">
      {visible.map(chip)}
      {overflow.length > 0 && (
        <HoverCard openDelay={150} closeDelay={150}>
          <HoverCardTrigger asChild>
            <Badge variant="secondary" className="cursor-default tabular-nums">
              +{overflow.length}
            </Badge>
          </HoverCardTrigger>
          <HoverCardContent className="w-auto max-w-[280px] p-2">
            <div className="flex flex-wrap items-center gap-2">
              {overflow.map(chip)}
            </div>
          </HoverCardContent>
        </HoverCard>
      )}
    </span>
  );
};

export { EnumerableGroup };
