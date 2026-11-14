// Wordmark.tsx — the वाक् VĀK brand. Use everywhere.
// Props: size "sm" (default, 20/13px) | "md" (24/14px) | "lg" (32/18px)

type WordmarkSize = "sm" | "md" | "lg";

type WordmarkProps = {
    size?: WordmarkSize;
    className?: string;
};

const sizeStyles: Record<WordmarkSize, { indicSize: string; latinSize: string }> = {
    sm: { indicSize: "20px", latinSize: "13px" },
    md: { indicSize: "24px", latinSize: "14px" },
    lg: { indicSize: "32px", latinSize: "18px" },
};

export default function Wordmark({ size = "sm", className }: WordmarkProps) {
    const { indicSize, latinSize } = sizeStyles[size];

    return (
        <div
            className={`wordmark brand${className ? ` ${className}` : ""}`}
            aria-label="VĀK"
        >
            <span
                className="brand-indic"
                style={{ fontSize: indicSize, color: "var(--text-primary)" }}
                aria-hidden="true"
            >
                वाक्
            </span>
            <span
                className="brand-latin"
                style={{ fontSize: latinSize, color: "var(--accent)" }}
                aria-hidden="true"
            >
                VĀK
            </span>
        </div>
    );
}
