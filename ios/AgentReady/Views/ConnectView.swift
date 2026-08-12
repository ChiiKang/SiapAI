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
        let url = URL(string: urlText.trimmingCharacters(in: .whitespaces))
        return url?.scheme == "https" && !keyText.trimmingCharacters(in: .whitespaces).isEmpty
    }

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    Text("Connect this phone")
                        .font(.largeTitle.bold())
                        .padding(.top, 32)

                    Text("Run one command on the Mac you code on. It pairs the CLI with this device.")
                        .font(.body)

                    step(
                        label: "STEP 1 — INSTALL",
                        content: "cd mac && npm install && npm run build && npm link"
                    )

                    step(
                        label: "STEP 2 — RUN SETUP ON THE MAC",
                        content: "agent-ready setup --api-base-url <url>"
                    )

                    VStack(alignment: .leading, spacing: 8) {
                        Text("STEP 3 — PASTE WHAT SETUP PRINTS")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        TextField("API base URL (https://…)", text: $urlText)
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
