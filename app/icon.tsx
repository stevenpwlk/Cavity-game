import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
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
            width: 22,
            height: 22,
            borderRadius: "50%",
            border: "4px solid #e4c05c",
            background: "#020a16"
          }}
        />
      </div>
    ),
    size
  );
}
