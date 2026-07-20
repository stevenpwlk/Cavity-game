import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#050e1e"
        }}
      >
        <div
          style={{
            width: 118,
            height: 118,
            borderRadius: "50%",
            border: "10px solid #e4c05c",
            background: "#020a16",
            display: "flex",
            alignItems: "center",
            justifyContent: "center"
          }}
        >
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: "50%",
              background: "linear-gradient(180deg, #fbf3dd, #c8a86f)"
            }}
          />
        </div>
      </div>
    ),
    size
  );
}
