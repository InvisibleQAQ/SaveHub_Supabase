import * as React from "react"
import { Loader2, Send, Square } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

type PromptInputProps = React.HTMLAttributes<HTMLDivElement>

const PromptInput = React.forwardRef<HTMLDivElement, PromptInputProps>(
  ({ className, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "border-t border-border/70 bg-background/90 px-6 py-4 backdrop-blur supports-[backdrop-filter]:bg-background/75",
          className
        )}
        {...props}
      />
    )
  }
)

PromptInput.displayName = "PromptInput"

type PromptInputTextareaProps = React.ComponentProps<typeof Textarea>

const PromptInputTextarea = React.forwardRef<
  HTMLTextAreaElement,
  PromptInputTextareaProps
>(({ className, ...props }, ref) => {
  return (
    <Textarea
      ref={ref}
      className={cn(
        "min-h-[60px] max-h-[200px] resize-none rounded-2xl border-border/70 bg-card px-4 py-3 text-sm shadow-sm focus-visible:ring-primary/50",
        className
      )}
      {...props}
    />
  )
})

PromptInputTextarea.displayName = "PromptInputTextarea"

type PromptInputSubmitProps = React.ComponentProps<typeof Button> & {
  isLoading?: boolean
}

const PromptInputSubmit = React.forwardRef<HTMLButtonElement, PromptInputSubmitProps>(
  ({ className, isLoading, children, ...props }, ref) => {
    return (
      <Button
        ref={ref}
        size="icon"
        className={cn("h-[60px] w-[60px] rounded-2xl shadow-sm", className)}
        {...props}
      >
        {children ??
          (isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <Send className="h-5 w-5" />
          ))}
      </Button>
    )
  }
)

PromptInputSubmit.displayName = "PromptInputSubmit"

type PromptInputStopProps = React.ComponentProps<typeof Button>

const PromptInputStop = React.forwardRef<HTMLButtonElement, PromptInputStopProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <Button
        ref={ref}
        type="button"
        variant="outline"
        className={cn("h-[60px] rounded-2xl px-4 shadow-sm", className)}
        {...props}
      >
        {children ?? (
          <span className="inline-flex items-center gap-2 text-sm">
            <Square className="h-3.5 w-3.5" />
            停止
          </span>
        )}
      </Button>
    )
  }
)

PromptInputStop.displayName = "PromptInputStop"

export { PromptInput, PromptInputTextarea, PromptInputSubmit, PromptInputStop }
