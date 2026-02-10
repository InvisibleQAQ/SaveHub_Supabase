import * as React from "react"
import { cn } from "@/lib/utils"

type ConversationProps = React.HTMLAttributes<HTMLDivElement>

const Conversation = React.forwardRef<HTMLDivElement, ConversationProps>(
  ({ className, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "relative flex-1 overflow-y-auto bg-gradient-to-b from-background via-background to-muted/20",
          className
        )}
        {...props}
      />
    )
  }
)

Conversation.displayName = "Conversation"

type ConversationContentProps = React.HTMLAttributes<HTMLDivElement>

const ConversationContent = React.forwardRef<
  HTMLDivElement,
  ConversationContentProps
>(({ className, ...props }, ref) => {
  return (
    <div
      ref={ref}
      className={cn("mx-auto flex w-full max-w-3xl flex-col gap-8 py-8", className)}
      {...props}
    />
  )
})

ConversationContent.displayName = "ConversationContent"

export { Conversation, ConversationContent }
