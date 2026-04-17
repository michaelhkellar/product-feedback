"use client";

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  className?: string;
  label?: string;
}

export function Sparkline({ data, width = 120, height = 28, color = "currentColor", className, label }: SparklineProps) {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data);
  const range = max - min || 1;
  const padY = 2;
  const innerH = height - padY * 2;

  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = padY + innerH - ((v - min) / range) * innerH;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const polyline = points.join(" ");
  // Area fill: close path to bottom
  const areaPoints = `0,${height} ${points.join(" ")} ${width},${height}`;

  const last = data[data.length - 1];
  const prev = data[data.length - 2];
  const trend = last > prev ? "up" : last < prev ? "down" : "flat";
  const trendColor = trend === "up" ? "#22c55e" : trend === "down" ? "#ef4444" : color;

  return (
    <span className={className} title={label}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} fill="none" style={{ display: "inline-block", verticalAlign: "middle" }}>
        <polygon points={areaPoints} fill={trendColor} fillOpacity={0.08} />
        <polyline points={polyline} stroke={trendColor} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
        {/* Last data point dot */}
        <circle
          cx={parseFloat(points[points.length - 1].split(",")[0])}
          cy={parseFloat(points[points.length - 1].split(",")[1])}
          r={2}
          fill={trendColor}
        />
      </svg>
    </span>
  );
}

interface SentimentBarProps {
  positive: number;
  negative: number;
  neutral: number;
  mixed?: number;
  showLabels?: boolean;
}

export function SentimentBar({ positive, negative, neutral, mixed = 0, showLabels = true }: SentimentBarProps) {
  const total = positive + negative + neutral + mixed;
  if (total === 0) return null;
  const posP = (positive / total) * 100;
  const negP = (negative / total) * 100;
  const neuP = ((neutral + mixed) / total) * 100;

  return (
    <div className="space-y-1">
      {showLabels && (
        <div className="flex items-center justify-between text-[9px] text-muted-foreground">
          <span className="text-green-500 font-medium">{Math.round(posP)}% pos</span>
          <span>{Math.round(neuP)}% neutral</span>
          <span className="text-red-500 font-medium">{Math.round(negP)}% neg</span>
        </div>
      )}
      <div className="flex h-1.5 rounded-full overflow-hidden bg-muted gap-px">
        {posP > 0 && <div className="bg-green-500 h-full transition-all" style={{ width: `${posP}%` }} />}
        {neuP > 0 && <div className="bg-muted-foreground/25 h-full transition-all" style={{ width: `${neuP}%` }} />}
        {negP > 0 && <div className="bg-red-500 h-full transition-all" style={{ width: `${negP}%` }} />}
      </div>
    </div>
  );
}
