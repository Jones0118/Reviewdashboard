import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

/** Bootstrapped root: just the router outlet (see app.routes.ts). */
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
export class Root {}
