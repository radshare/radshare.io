import { BrowserModule } from '@angular/platform-browser';
import { NgModule } from '@angular/core';

import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { FormsModule } from '@angular/forms';
import { HttpClientModule } from '@angular/common/http';
import { SettingsComponent } from './settings/settings.component';
import { LoginComponent } from './login/login.component';
import { HomeComponent } from './home/home.component';
import { RegisterComponent } from './register/register.component';
import { PasswordConfirmationValidator } from './validators/password-confirmation-validator.directive';
import { UniqueEmailValidator } from './validators/unique-email-validator.directive';
import { WhitespaceValidator } from './validators/whitespace-validator.directive';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatTableModule } from '@angular/material/table';
import { MatDialogModule } from '@angular/material/dialog';
import { RadDialogComponent } from './home/raddialog/rad-dialog.component';
import { MatSortModule } from '@angular/material/sort';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { ReactiveFormsModule } from '@angular/forms';
import { NgxMatSelectSearchModule } from 'ngx-mat-select-search';

@NgModule({
  declarations: [
    AppComponent,
    SettingsComponent,
    LoginComponent,
    HomeComponent,
    RegisterComponent,
    PasswordConfirmationValidator,
    UniqueEmailValidator,
    WhitespaceValidator,
    RadDialogComponent,
  ],
  imports: [BrowserModule, AppRoutingModule, FormsModule,
    HttpClientModule, BrowserAnimationsModule, ReactiveFormsModule, MatPaginatorModule,
    MatTableModule, MatDialogModule, MatSortModule, MatFormFieldModule, MatSelectModule,
    NgxMatSelectSearchModule],
  providers: [],
  bootstrap: [AppComponent],
  entryComponents:[]
})
export class AppModule {}
