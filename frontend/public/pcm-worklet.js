class Pcm16Processor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.frameSize = 512;
        this.frame = new Int16Array(this.frameSize);
        this.offset = 0;
    }

    process(inputs, outputs) {
        const input = inputs[0]?.[0];

        // Keep the processor running without playing microphone audio.
        for (const channel of outputs[0] ?? []) {
            channel.fill(0);
        }

        if (!input) return true;

        for (let i = 0; i < input.length; i++) {
            const sample = Math.max(-1, Math.min(1, input[i]));

            this.frame[this.offset++] =
                sample < 0 ? sample * 32768 : sample * 32767;

            if (this.offset === this.frameSize) {
                const packet = this.frame;

                this.frame = new Int16Array(this.frameSize);
                this.offset = 0;

                // Transfer the 1024-byte PCM frame to the main thread.
                this.port.postMessage(packet.buffer, [packet.buffer]);
            }
        }

        return true;
    }
}

registerProcessor("pcm16-processor", Pcm16Processor);