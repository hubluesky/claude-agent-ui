interface SearchBoxProps {
  value: string
  onChange: (value: string) => void
  placeholder: string
}

export function SearchBox({ value, onChange, placeholder }: SearchBoxProps) {
  return (
    <div className="px-3 pt-2.5 pb-1.5">
      <div className="flex items-center gap-1.5 h-8 px-2.5 bg-[#2b2a27] rounded-md border border-[#3d3b37] focus-within:border-[#d97706] transition-colors">
        <svg className="w-3.5 h-3.5 text-[#7c7872] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="flex-1 bg-transparent border-none outline-none text-[#e5e2db] text-xs placeholder-[#7c7872]"
        />
      </div>
    </div>
  )
}
