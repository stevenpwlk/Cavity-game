import { ImageResponse } from "next/og";

export async function GET() {
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
            width: 128,
            height: 128,
            borderRadius: "50%",
            border: "10px solid #e4c05c",
            background: "#020a16",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 0 0 4px rgba(228,192,92,0.18)"
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: "50%",
              background: "linear-gradient(180deg, #fbf3dd, #c8a86f)"
            }}
          />
        </div>
      </div>
    ),
    { width: 192, height: 192 }
  );
}
