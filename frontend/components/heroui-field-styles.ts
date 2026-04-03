export const TM_INPUT_CLASSNAMES = {
  label:
    "pointer-events-auto text-slate-500 transition-none !transform-none dark:text-slate-400 group-data-[focus=true]:text-slate-700 dark:group-data-[focus=true]:text-slate-200",
  inputWrapper:
    "rounded-2xl border-[1.5px] border-slate-300/90 bg-transparent shadow-none transition-colors duration-200 data-[hover=true]:border-slate-400 data-[hover=true]:bg-transparent group-data-[focus=true]:border-sky-500 group-data-[focus=true]:bg-transparent dark:border-slate-600/90 dark:bg-transparent dark:data-[hover=true]:border-slate-500 dark:data-[hover=true]:bg-transparent dark:group-data-[focus=true]:border-sky-500 dark:group-data-[focus=true]:bg-transparent",
  innerWrapper: "bg-transparent shadow-none",
  input:
    "bg-transparent text-slate-900 shadow-none placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-500",
  clearButton: "text-slate-400 dark:text-slate-400",
} as const

export const TM_SELECT_CLASSNAMES = {
  label:
    "pointer-events-auto text-slate-500 transition-none !transform-none dark:text-slate-400",
  trigger:
    "rounded-2xl border-[1.5px] border-slate-300/90 bg-transparent shadow-none transition-colors duration-200 data-[hover=true]:border-slate-400 data-[hover=true]:bg-transparent data-[focus=true]:border-sky-500 data-[focus=true]:bg-transparent data-[open=true]:border-sky-500 data-[open=true]:bg-transparent dark:border-slate-600/90 dark:bg-transparent dark:data-[hover=true]:border-slate-500 dark:data-[hover=true]:bg-transparent dark:data-[focus=true]:border-sky-500 dark:data-[focus=true]:bg-transparent dark:data-[open=true]:border-sky-500 dark:data-[open=true]:bg-transparent",
  innerWrapper: "bg-transparent shadow-none",
  value: "text-slate-900 dark:text-slate-100",
  selectorIcon: "text-slate-400 dark:text-slate-400",
  popoverContent:
    "border border-slate-200/80 bg-white/95 p-1 shadow-xl shadow-slate-950/5 backdrop-blur-xl dark:border-slate-800/90 dark:bg-slate-950/96",
} as const
