export const SearchSkeleton = () => {
  return (
    <div className="w-full max-w-sm mx-auto">
      <div className="glass-card flex flex-col animate-pulse">
        <div className="aspect-square bg-muted/50 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent -translate-x-full animate-[shimmer_2s_infinite]"></div>
        </div>
        <div className="p-4 space-y-3">
          <div className="h-4 bg-muted/50 rounded w-3/4"></div>
          <div className="flex justify-between items-center">
            <div className="h-3 bg-muted/50 rounded w-1/2"></div>
            <div className="h-3 bg-muted/50 rounded w-1/4"></div>
          </div>
          <div className="h-10 bg-muted/50 rounded-lg w-full mt-2"></div>
        </div>
      </div>
    </div>
  );
};
