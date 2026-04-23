"use client";

import * as React from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";

import { cn } from "@/lib/utils";

const ResizablePanelGroup = React.forwardRef<
  React.ElementRef<typeof PanelGroup>,
  React.ComponentPropsWithoutRef<typeof PanelGroup>
>(({ className, ...props }, ref) => (
  <PanelGroup
    ref={ref}
    className={cn(
      "flex h-full w-full data-[panel-group-direction=vertical]:flex-col",
      className
    )}
    {...props}
  />
));
ResizablePanelGroup.displayName = "ResizablePanelGroup";

function ResizablePanel({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof Panel>) {
  return <Panel className={cn("h-full w-full", className)} {...props} />
}

function ResizableHandle({
  className,
  withHandle,
  ...props
}: React.ComponentPropsWithoutRef<typeof PanelResizeHandle> & {
  withHandle?: boolean;
}) {
  return (
    <PanelResizeHandle
      className={cn(
        "relative flex w-px items-center justify-center bg-border focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 data-[panel-group-direction=vertical]:h-px data-[panel-group-direction=vertical]:w-full [&[data-panel-group-direction=horizontal]]:cursor-col-resize [&[data-panel-group-direction=vertical]]:cursor-row-resize",
        className
      )}
      {...props}
    >
      {withHandle ? (
        <div className="z-10 flex h-2 w-2 items-center justify-center rounded-full border-4 border-border border-primary bg-primary">
          <span className="h-3 w-0.5 rounded-full bg-border data-[panel-group-direction=vertical]:h-0.5 data-[panel-group-direction=vertical]:w-3" />
        </div>
      ) : null}
    </PanelResizeHandle>
  )
}

export { ResizablePanelGroup, ResizablePanel, ResizableHandle };
