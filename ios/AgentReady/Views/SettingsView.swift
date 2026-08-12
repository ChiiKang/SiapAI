import SwiftUI
import UIKit // UIPasteboard for the copy action

// The few things a person genuinely needs after pairing. A pushed leaf
// screen, not a tab.
struct SettingsView: View {
    @EnvironmentObject private var settings: SettingsStore

    @State private var keyRevealed = false
    @State private var showRotateAlert = false

    var body: some View {
        Form {
            Section {
                TextField("Machine label", text: $settings.machineLabel)
            } header: {
                Text("MACHINE")
            } footer: {
                Text("Label only. Shown as row metadata on every session.")
            }

            Section {
                HStack {
                    Text(keyRevealed ? settings.deviceKey : settings.maskedDeviceKey)
                        .font(.footnote.monospaced())
                        .lineLimit(1)
                        .truncationMode(.middle)
                    Spacer()
                    Button {
                        UIPasteboard.general.string = settings.deviceKey
                    } label: {
                        Image(systemName: "doc.on.doc")
                            .accessibilityLabel("Copy device key")
                    }
                    .disabled(settings.deviceKey.isEmpty)
                }
                TextField("API base URL", text: $settings.apiBaseURLString)
                    .font(.footnote.monospaced())
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                HStack(spacing: 12) {
                    Button(keyRevealed ? "Hide" : "Reveal") {
                        keyRevealed.toggle()
                    }
                    .buttonStyle(.bordered)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    Button("Rotate key") {
                        showRotateAlert = true
                    }
                    .buttonStyle(.bordered)
                    .tint(.accentColor)
                    .frame(maxWidth: .infinity, minHeight: 44)
                }
            } header: {
                Text("DEVICE KEY")
            }

            Section {
                Toggle("Notify on READY", isOn: $settings.notifyOnReady)
                LabeledContent("Delivery", value: "Telegram bot")
            } header: {
                Text("NOTIFICATIONS")
            } footer: {
                Text("Delivered by the Telegram bot in V1; switches to native push once the Apple Developer enrollment lands.")
            }

            Section {
                Text("No prompts, terminal output, file names, or source code ever leave the Mac.")
                    .font(.footnote)
            } header: {
                Text("PRIVACY")
            }
        }
        .navigationTitle("Settings")
        .navigationBarTitleDisplayMode(.inline)
        .alert("Rotate the device key?", isPresented: $showRotateAlert) {
            Button("Clear key here", role: .destructive) {
                settings.deviceKey = ""
                keyRevealed = false
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Rotation happens on the Mac: re-run `agent-ready setup`, update the DEVICE_KEY secret on Supabase, then paste the new key here. This clears the old key from this phone and requires re-pairing.")
        }
    }
}
