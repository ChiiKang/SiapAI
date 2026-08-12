import SwiftUI

// Onboarding: connect the phone to the CLI once, on first launch.
//
// The wireframe's automatic pairing-code exchange needs a pairing endpoint
// the plan's contract doesn't define, so V1 pairs by pasting the values that
// `agent-ready setup` prints on the Mac (plan wins on architecture; see
// docs/testing.md § Known limitations).
struct ConnectView: View {
    @EnvironmentObject private var settings: SettingsStore
    @Environment(\.dismiss) private var dismiss

    @State private var urlText = ""
    @State private var keyText = ""

    private var canSave: Bool {
        ServerURL.validated(urlText) != nil
            && !keyText.trimmingCharacters(in: .whitespaces).isEmpty
    }

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    Text("Connect this phone")
                        .font(.largeTitle.bold())
                        .padding(.top, 32)

                    Text("Run two commands on the Mac you code on, then paste what they print. Keep this phone on the same Wi-Fi.")
                        .font(.body)

                    step(
                        label: "STEP 1 — SET UP (PRINTS YOUR DEVICE KEY)",
                        content: "agent-ready setup --local"
                    )

                    step(
                        label: "STEP 2 — START THE SERVER (PRINTS ITS ADDRESS)",
                        content: "agent-ready serve"
                    )

                    VStack(alignment: .leading, spacing: 8) {
                        Text("STEP 3 — PASTE BOTH HERE")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        TextField("http://192.168.1.24:8787", text: $urlText)
                            .textFieldStyle(.roundedBorder)
                            .keyboardType(.URL)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                        SecureField("Device key (dk_…)", text: $keyText)
                            .textFieldStyle(.roundedBorder)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                    }
                }
                .padding(.horizontal, 20)
            }

            VStack(spacing: 8) {
                Button {
                    settings.apiBaseURLString = urlText.trimmingCharacters(in: .whitespaces)
                    settings.deviceKey = keyText.trimmingCharacters(in: .whitespaces)
                    dismiss()
                } label: {
                    Text("Save & connect")
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.borderedProminent)
                .disabled(!canSave)

                Button("Skip for now") {
                    settings.skippedOnboarding = true
                    dismiss()
                }
                .frame(minHeight: 44)
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 12)
        }
        .onAppear {
            urlText = settings.apiBaseURLString
        }
    }

    private func step(label: String, content: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(content)
                .font(.footnote.monospaced())
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 8))
        }
    }
}
