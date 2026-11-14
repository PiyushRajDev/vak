const productionOrigins = (process.env.WEB_ORIGIN || "")
    .split(",")
    .map(origin => origin.trim())
    .filter(Boolean);

function isPrivateIPv4(hostname) {
    const parts = hostname.split(".").map(Number);

    if (parts.length !== 4 || parts.some(n =>
        !Number.isInteger(n) || n < 0 || n > 255
    )) return false;

    return (
        parts[0] === 10 ||
        (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
        (parts[0] === 192 && parts[1] === 168)
    );
}

export function isAllowedOrigin(origin) {
    if (!origin) return true;

    let parsed;

    try {
        parsed = new URL(origin);
    } catch {
        return false;
    }

    if (productionOrigins.includes(parsed.origin)) {
        return true;
    }

    // Localhost and LAN access only during development.
    if (process.env.NODE_ENV !== "production") {
        const hostname = parsed.hostname;

        return (
            hostname === "localhost" ||
            hostname === "127.0.0.1" ||
            isPrivateIPv4(hostname)
        );
    }

    return false;
}