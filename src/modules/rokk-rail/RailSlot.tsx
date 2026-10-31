import { ResizableHandle, ResizablePanel } from "@/components/ui/resizable";
import { type ReactNode, useEffect } from "react";
import {
  persistRailWidth,
  RAIL_MAX_WIDTH,
  RAIL_MIN_WIDTH,
  readRailWidth,
  useRailOpen,
} from "./lib/railState";
import { startTimelineRecorder } from "./lib/timeline";

/** The rail's place in the main panel group: nothing while closed, a handle
 * and a panel while open. The content (children) is the lazy SessionRail. */
export function RokkRailSlot({ children }: { children: ReactNode }) {
  const open = useRailOpen();
  useEffect(() => startTimelineRecorder(), []);
  if (!open) return null;
  return (
    <>
      <ResizableHandle className="-ml-1 w-1 rounded-full bg-transparent transition-colors duration-[var(--dur-fast)] after:w-4 hover:bg-border" />
      <ResizablePanel
        id="rokk-rail"
        defaultSize={`${readRailWidth()}px`}
        minSize={`${RAIL_MIN_WIDTH}px`}
        maxSize={`${RAIL_MAX_WIDTH}px`}
        onResize={(size) => persistRailWidth(size.inPixels)}
      >
        <div className="h-full min-h-0 pr-2">{children}</div>
      </ResizablePanel>
    </>
  );
}
