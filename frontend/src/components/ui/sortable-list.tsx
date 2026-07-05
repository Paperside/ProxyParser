import type { ReactNode } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DraggableAttributes,
  type DraggableSyntheticListeners
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";

import { cn } from "../../lib/cn";

// 通用拖拽排序列表：任何"需要上下调整顺序"的地方都复用这一套（组成员、代理组顺序、规则块、规则项）。
// 传入 items（需各自有唯一 id）+ renderItem，内部处理拖拽状态与顺序回调。

export interface DragHandleProps {
  attributes: DraggableAttributes;
  listeners: DraggableSyntheticListeners;
}

export const SortableItem = ({
  id,
  children,
  className
}: {
  id: string;
  children: (handleProps: DragHandleProps) => ReactNode;
  className?: string;
}) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(isDragging ? "z-10 opacity-90" : "", className)}
    >
      {children({ attributes, listeners })}
    </div>
  );
};

export const DragHandle = ({
  attributes,
  listeners,
  className
}: DragHandleProps & { className?: string }) => (
  <button
    type="button"
    className={cn("cursor-grab touch-none text-faint hover:text-ink active:cursor-grabbing", className)}
    title="拖拽调整顺序"
    {...attributes}
    {...listeners}
  >
    <GripVertical className="size-3.5" />
  </button>
);

export function SortableList<T extends { id: string }>({
  items,
  onReorder,
  renderItem,
  className
}: {
  items: T[];
  onReorder: (nextItems: T[]) => void;
  renderItem: (item: T, handle: DragHandleProps) => ReactNode;
  className?: string;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((item) => item.id === active.id);
    const newIndex = items.findIndex((item) => item.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = [...items];
    const [moved] = next.splice(oldIndex, 1);
    next.splice(newIndex, 0, moved!);
    onReorder(next);
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
        <div className={className}>
          {items.map((item) => (
            <SortableItem key={item.id} id={item.id}>
              {(handle) => renderItem(item, handle)}
            </SortableItem>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
