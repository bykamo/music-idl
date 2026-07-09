
const Loader = () => {
  return (
    <div className="relative min-h-screen w-full bg-background fixed inset-0 z-[100] overflow-x-hidden">
      <div className="max-w-5xl mx-auto px-4 py-8 relative">
        
        {/* Header Section Skeleton */}
        <div className="text-center mb-10 space-y-4 pt-6 md:pt-2 w-full max-w-2xl mx-auto animate-pulse">
          {/* Title placeholder */}
          <div className="h-10 md:h-14 bg-muted/40 rounded-3xl w-48 mx-auto relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent -translate-x-full animate-[shimmer_1.5s_infinite]"></div>
          </div>
          {/* Subtitle placeholder */}
          <div className="h-4 md:h-5 bg-muted/30 rounded-xl w-3/4 md:w-2/3 mx-auto relative overflow-hidden mt-3">
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent -translate-x-full animate-[shimmer_1.5s_infinite]"></div>
          </div>
        </div>

        {/* Tabs Selector Skeleton */}
        <div className="flex justify-center gap-3 mb-6 w-full animate-pulse">
          <div className="h-11 bg-muted/40 rounded-full w-28 relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent -translate-x-full animate-[shimmer_1.5s_infinite]"></div>
          </div>
          <div className="h-11 bg-muted/40 rounded-full w-36 relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent -translate-x-full animate-[shimmer_1.5s_infinite]"></div>
          </div>
        </div>

        {/* Input Search Form Skeleton */}
        <div className="w-full max-w-2xl mx-auto mb-10 md:mb-12 animate-pulse">
          <div className="h-14 bg-muted/40 rounded-full w-full relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent -translate-x-full animate-[shimmer_1.5s_infinite]"></div>
          </div>
          <div className="mt-4 flex flex-col items-center">
            <div className="h-12 bg-muted/40 rounded-full w-40 relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent -translate-x-full animate-[shimmer_1.5s_infinite]"></div>
            </div>
          </div>
        </div>

        {/* Ready steps center section */}
        <div className="text-center py-16 md:py-24 animate-pulse w-full">
          {/* Circular icon placeholder */}
          <div className="inline-block h-24 w-24 rounded-full bg-card border border-border mb-6 shadow-sm relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent -translate-x-full animate-[shimmer_1.5s_infinite]"></div>
          </div>
          
          {/* Ready title placeholder */}
          <div className="h-7 bg-muted/40 rounded-xl w-56 mx-auto mb-8 relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent -translate-x-full animate-[shimmer_1.5s_infinite]"></div>
          </div>

          {/* Steps Cards Skeleton Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-2xl mx-auto text-left">
            {[1, 2, 3].map((item) => (
              <div key={item} className="rounded-2xl border border-border bg-card/80 p-4 h-32 relative overflow-hidden">
                <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-full bg-muted/50"></div>
                <div className="h-4 bg-muted/40 rounded-md w-3/4 mb-2"></div>
                <div className="h-3 bg-muted/30 rounded-md w-full"></div>
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent -translate-x-full animate-[shimmer_1.5s_infinite]"></div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
};

export default Loader;
