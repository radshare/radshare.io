import { Component, OnInit } from '@angular/core';
import {RelicService} from '../../services/relic.service';
import {IRoom} from '../../../../../api/src/schema';

@Component({
  selector: 'app-radgroup',
  templateUrl: './radgroup.component.html',
  styleUrls: ['./radgroup.component.css']
})
export class RadgroupComponent implements OnInit {
  roomData: IRoom;
  usersArray: Array<{email: string, username: string}>;

  constructor(private relicsService: RelicService) { }

  ngOnInit(): void {
    this.relicsService.loadRoomDetails().subscribe(data => {
      console.log(data.result);
      this.roomData = data.result;
      this.usersArray = data.result.tenno;
    });
  }

}
