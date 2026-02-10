import * as React from "react"
import { User, Bot } from "lucide-react"
import { cn } from "@/lib/utils"

type MessageProps = React.HTMLAttributes<HTMLDivElement> & {
  from: "user" | "assistant"
}

const Message = React.forwardRef<HTMLDivElement, MessageProps>(
  ({ className, from, ...props }, ref) => {
    return (
      <div
        ref={ref}
        data-from={from}
        className={cn(
          "group flex gap-3",
          from === "user" && "flex-row-reverse",
          className
        )}
        {...props}
      />
    )
  }
)

Message.displayName = "Message"

type MessageAvatarProps = React.HTMLAttributes<HTMLDivElement> & {
  from: "user" | "assistant"
}

const MessageAvatar = React.forwardRef<HTMLDivElement, MessageAvatarProps>(
  ({ className, from, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "mt-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border shadow-sm",
          from === "user"
            ? "border-primary/30 bg-primary text-primary-foreground"
            : "border-border/70 bg-card text-foreground",
          className
        )}
        {...props}
      >
        {children ??
          (from === "user" ? (
            <User className="h-4 w-4" />
          ) : (
            <Bot className="h-4 w-4" />
          ))}
      </div>
    )
  }
)

MessageAvatar.displayName = "MessageAvatar"

type MessageContentProps = React.HTMLAttributes<HTMLDivElement> & {
  from: "user" | "assistant"
}

const MessageContent = React.forwardRef<HTMLDivElement, MessageContentProps>(
  ({ className, from, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "flex-1 max-w-[86%] rounded-2xl border px-4 py-3 shadow-sm",
          from === "user"
            ? "border-primary/30 bg-primary text-primary-foreground"
            : "border-border/70 bg-card text-card-foreground",
          className
        )}
        {...props}
      />
    )
  }
)

MessageContent.displayName = "MessageContent"

export { Message, MessageAvatar, MessageContent }
