import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';

import { CameraService } from '../../services/camera.service';

import type { Camera } from '../../models/camera.model';

@Component({
  selector: 'app-camera-editor',
  templateUrl: './camera-editor.html',
  styleUrl: './camera-editor.css',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class CameraEditorComponent {
  private readonly cameraService = inject(CameraService);

  readonly camera = input.required<Camera>();

  protected cloneCamera(): void {
    this.cameraService.cloneCamera(this.camera().id);
  }

  protected updateName(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.cameraService.updateCamera(this.camera().id, { name: value });
  }

  protected updateHeading(event: Event): void {
    const value = +(event.target as HTMLInputElement).value;
    this.cameraService.updateCamera(this.camera().id, { heading: value });
  }

  protected updateFov(event: Event): void {
    const value = +(event.target as HTMLInputElement).value;
    this.cameraService.updateCamera(this.camera().id, { fov: value });
  }

  protected updateRange(event: Event): void {
    const value = +(event.target as HTMLInputElement).value;
    this.cameraService.updateCamera(this.camera().id, { range: value });
  }
}
