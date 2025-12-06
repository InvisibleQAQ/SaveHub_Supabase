"use client"

import * as React from "react"
import { Check, ChevronDown } from "lucide-react"

import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

export interface ComboboxOption {
  value: string
  label: string
}

interface ComboboxProps {
  options: ComboboxOption[]
  value?: string
  onValueChange?: (value: string) => void
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  className?: string
  disabled?: boolean
}

export function Combobox({
  options,
  value = "",
  onValueChange,
  placeholder = "选择选项...",
  searchPlaceholder = "搜索...",
  emptyText = "未找到选项",
  className,
  disabled = false,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)

  const handleSelect = (selectedValue: string) => {
    onValueChange?.(selectedValue)
    setOpen(false)
    // Focus back to input after selection
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value
    onValueChange?.(newValue)
    if (!open && newValue) {
      setOpen(true)
    }
  }

  const filteredOptions = options.filter((option) =>
    option.label.toLowerCase().includes(value.toLowerCase()) ||
    option.value.toLowerCase().includes(value.toLowerCase())
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="relative">
        <Input
          ref={inputRef}
          value={value}
          onChange={handleInputChange}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          disabled={disabled}
          className={cn("pr-8", className)}
        />
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            className="absolute right-0 top-0 h-full px-3 hover:bg-accent hover:text-accent-foreground disabled:opacity-50 disabled:cursor-not-allowed rounded-r-md transition-colors"
          >
            <ChevronDown className="h-4 w-4 opacity-50" />
          </button>
        </PopoverTrigger>
      </div>
      <PopoverContent
        className="p-0"
        align="start"
        style={{ width: inputRef.current?.offsetWidth }}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <Command>
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {filteredOptions.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.value}
                  onSelect={() => handleSelect(option.value)}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === option.value ? "opacity-100" : "opacity-0"
                    )}
                  />
                  {option.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
