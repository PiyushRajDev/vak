const TARGET_SAMPLE_RATE = 16000;
const FRAME_SIZE = 512;

class Pcm16Processor extends AudioWorkletProcessor {
    constructor() {
        super();

        // AudioWorklet's global sampleRate is the actual AudioContext rate.
        // Resample continuously so the STT provider always receives 16 kHz,
        // regardless of whether the browser runs at 44.1 or 48 kHz.
        this.sourceRate = sampleRate;
        this.resampleStep = this.sourceRate / TARGET_SAMPLE_RATE;
        this.sourcePosition = 0;
        this.nextOutputPosition = 0;
        this.previousSample = 0;
        this.filteredSample = 0;
        this.hasPreviousSample = false;

        // A gentle low-pass before downsampling limits high-frequency aliasing.
        this.lowPassAlpha = 1 - Math.exp(
            (-2 * Math.PI * 7200) / this.sourceRate
        );

        this.frame = new Int16Array(FRAME_SIZE);
        this.offset = 0;
    }

    writeOutputSample(value) {
        const sample = Math.max(-1, Math.min(1, value));

        this.frame[this.offset++] =
            sample < 0 ? sample * 32768 : sample * 32767;

        if (this.offset === FRAME_SIZE) {
            const packet = this.frame;
            this.frame = new Int16Array(FRAME_SIZE);
            this.offset = 0;

            // Transfer a 1024-byte PCM16 frame (512 samples at 16 kHz).
            this.port.postMessage(packet.buffer, [packet.buffer]);
        }
    }

    process(inputs, outputs) {
        const input = inputs[0]?.[0];

        // Keep the processor running without monitoring the microphone.
        for (const channel of outputs[0] ?? []) {
            channel.fill(0);
        }

        if (!input?.length) {
            return true;
        }

        for (let i = 0; i < input.length; i++) {
            const sample = input[i];

            this.filteredSample +=
                this.lowPassAlpha * (sample - this.filteredSample);

            if (!this.hasPreviousSample) {
                this.previousSample = this.filteredSample;
                this.hasPreviousSample = true;
                this.writeOutputSample(this.filteredSample);
                this.nextOutputPosition = this.resampleStep;
                this.sourcePosition = 1;
                continue;
            }

            const currentPosition = this.sourcePosition;

            while (this.nextOutputPosition <= currentPosition) {
                const fraction = Math.max(
                    0,
                    Math.min(
                        1,
                        this.nextOutputPosition - (currentPosition - 1)
                    )
                );

                const outputSample =
                    this.previousSample +
                    (this.filteredSample - this.previousSample) * fraction;

                this.writeOutputSample(outputSample);
                this.nextOutputPosition += this.resampleStep;
            }

            this.previousSample = this.filteredSample;
            this.sourcePosition += 1;
        }

        return true;
    }
}

registerProcessor("pcm16-processor", Pcm16Processor);
