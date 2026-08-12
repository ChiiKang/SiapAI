import SwiftUI

// One session row. Status reads from a text label plus a shape — never color
// alone (the one non-negotiable visual rule). 8pt shapes: filled = READY,
// hollow = RUNNING, dashed = STALE.
struct AgentRowView: View {
    let session: AgentSession
    let now: Date
    // Set while the error banner shows: metadata becomes "… · stale · 12:44".
    let staleDataAsOf: Date?

    private var state: DisplayState { session.displayState(now: now) }

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(session.displayName)
                    .font(.headline)
                    .foregroundStyle(state == .stale ? Color.secondary : Color.primary)
                    .lineLimit(2) // Dynamic Type may wrap the name; never truncate it
                Text(
                    staleDataAsOf.map(session.staleDataMetadata(asOf:))
                        ?? session.metadata(now: now)
                )
                .font(.footnote)
                .foregroundStyle(.secondary)
            }
            Spacer(minLength: 8)
            HStack(spacing: 6) {
                statusShape
                Text(state.label)
                    .font(.caption.monospaced())
                    .tracking(1.2)
                    .foregroundStyle(state == .ready ? Color.accentColor : Color.secondary)
                    .lineLimit(1)
                    .fixedSize() // the status label never wraps
            }
        }
        .frame(minHeight: 44)
        .listRowBackground(
            state == .ready ? Color(.secondarySystemBackground) : Color(.systemBackground)
        )
    }

    @ViewBuilder
    private var statusShape: some View {
        switch state {
        case .ready:
            Rectangle()
                .fill(Color.accentColor)
                .frame(width: 8, height: 8)
        case .running:
            Rectangle()
                .strokeBorder(Color.secondary, lineWidth: 1.5)
                .frame(width: 8, height: 8)
        case .stale:
            Rectangle()
                .strokeBorder(
                    Color.secondary,
                    style: StrokeStyle(lineWidth: 1.5, dash: [2, 2])
                )
                .frame(width: 8, height: 8)
        }
    }
}
